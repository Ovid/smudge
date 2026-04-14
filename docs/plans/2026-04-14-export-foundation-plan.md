# Export Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-side export of manuscripts as HTML, Markdown, or plain text, with a minimal client-side export dialog.

**Architecture:** New `packages/server/src/export/` module (routes, service, renderers). Server gathers chapters, renders to the chosen format, returns a file download. Client adds an ExportDialog triggered from the project header. Migration adds `author_name` to projects.

**Tech Stack:** Express, Zod, `@tiptap/html`, `turndown`, Vitest/Supertest, Playwright

**Design doc:** `docs/plans/2026-04-14-export-foundation-design.md`

---

## Task 1: Database Migration — Add `author_name` to Projects

**Files:**
- Create: `packages/server/src/db/migrations/011_add_author_name.js`
- Modify: `packages/server/src/projects/projects.types.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schemas.ts`
- Test: `packages/server/src/__tests__/migrations.test.ts`

**Step 1: Write the migration**

Create `packages/server/src/db/migrations/011_add_author_name.js`:

```javascript
exports.up = async function (knex) {
  await knex.schema.alterTable("projects", (table) => {
    table.text("author_name").nullable().defaultTo(null);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("author_name");
  });
};
```

**Step 2: Update `ProjectRow` type**

In `packages/server/src/projects/projects.types.ts`, add `author_name: string | null` to `ProjectRow`. Add `author_name?: string | null` to `UpdateProjectData`.

**Step 3: Update shared `Project` type**

In `packages/shared/src/types.ts`, add `author_name: string | null` to the `Project` interface.

**Step 4: Update `UpdateProjectSchema`**

In `packages/shared/src/schemas.ts`, add `author_name` to `UpdateProjectSchema`:

```typescript
author_name: z.string().trim().max(500, "Author name is too long").nullable(),
```

**Step 5: Run the existing migration test**

Run: `npm test -w packages/server -- --run migrations`

Expected: PASS — the migration test verifies all migrations run cleanly.

**Step 6: Commit**

```
feat(export): add author_name column to projects table
```

---

## Task 2: Wire `author_name` Through Service and Routes

**Files:**
- Modify: `packages/server/src/projects/projects.service.ts` (updateProject function)
- Modify: `packages/client/src/api/client.ts` (update method type)
- Test: `packages/server/src/__tests__/projects.test.ts`

**Step 1: Write failing test for PATCH with author_name**

In `packages/server/src/__tests__/projects.test.ts`, add a test:

```typescript
it("PATCH /api/projects/:slug updates author_name", async () => {
  const create = await request(t.app)
    .post("/api/projects")
    .send({ title: "Author Test", mode: "fiction" });
  const slug = create.body.slug;

  const res = await request(t.app)
    .patch(`/api/projects/${slug}`)
    .send({ author_name: "Jane Doe" });

  expect(res.status).toBe(200);
  expect(res.body.author_name).toBe("Jane Doe");
});

it("PATCH /api/projects/:slug clears author_name with null", async () => {
  const create = await request(t.app)
    .post("/api/projects")
    .send({ title: "Author Clear Test", mode: "fiction" });
  const slug = create.body.slug;

  await request(t.app)
    .patch(`/api/projects/${slug}`)
    .send({ author_name: "Jane Doe" });

  const res = await request(t.app)
    .patch(`/api/projects/${slug}`)
    .send({ author_name: null });

  expect(res.status).toBe(200);
  expect(res.body.author_name).toBeNull();
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run projects.test`

Expected: FAIL — `author_name` not in schema, validation rejects unknown fields.

**Step 3: Update service to handle author_name**

In `packages/server/src/projects/projects.service.ts`, in the `updateProject` function, add after the `target_deadline` handling:

```typescript
if (parsed.data.author_name !== undefined) {
  updates.author_name = parsed.data.author_name;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run projects.test`

Expected: PASS

**Step 5: Update client API types**

In `packages/client/src/api/client.ts`, add `author_name?: string | null` to the `api.projects.update` data parameter type.

**Step 6: Commit**

```
feat(export): wire author_name through project update API
```

---

## Task 3: Add `author_name` to ProjectSettingsDialog

**Files:**
- Modify: `packages/client/src/strings.ts`
- Modify: `packages/client/src/components/ProjectSettingsDialog.tsx`
- Modify: `packages/client/src/pages/EditorPage.tsx` (pass author_name in project prop)
- Test: `packages/client/src/__tests__/ProjectSettingsDialog.test.tsx` (if exists, otherwise the e2e covers this)

**Step 1: Add strings**

In `packages/client/src/strings.ts`, add to `projectSettings`:

```typescript
authorName: "Author name",
authorNamePlaceholder: "e.g. Jane Doe",
```

**Step 2: Add author name field to ProjectSettingsDialog**

In `packages/client/src/components/ProjectSettingsDialog.tsx`:

- Add `author_name: string | null` to the `project` prop interface
- Add state: `const [authorName, setAuthorName] = useState(project.author_name ?? "")`
- Re-sync on open (in the `if (open !== prevOpen)` block): `setAuthorName(project.author_name ?? "")`
- Add confirmed ref tracking like other fields
- Add a text input field in the form, after the deadline field and before the timezone section:

```tsx
<div>
  <label
    className="block text-sm font-medium text-text-secondary mb-1 font-sans"
    htmlFor="project-author-name"
  >
    {STRINGS.projectSettings.authorName}
  </label>
  <input
    id="project-author-name"
    type="text"
    value={authorName}
    onChange={(e) => setAuthorName(e.target.value)}
    onBlur={handleAuthorNameBlur}
    className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
    placeholder={STRINGS.projectSettings.authorNamePlaceholder}
  />
</div>
```

- Add blur handler:

```typescript
function handleAuthorNameBlur() {
  const trimmed = authorName.trim();
  saveField({ author_name: trimmed || null });
}
```

**Step 3: Update EditorPage project prop**

In `packages/client/src/pages/EditorPage.tsx`, the `ProjectSettingsDialog` receives `project={project}`. The `project` state already comes from `api.projects.get()` which returns a `ProjectWithChapters` (extends `Project`). Since we added `author_name` to the shared `Project` type in Task 1, this will flow through automatically. Just verify the `ProjectSettingsDialogProps` interface includes `author_name`.

**Step 4: Run client tests**

Run: `npm test -w packages/client -- --run`

Expected: PASS

**Step 5: Commit**

```
feat(export): add author name field to project settings dialog
```

---

## Task 4: Install Server Dependencies

**Files:**
- Modify: `packages/server/package.json` (via npm install)

**Step 1: Install @tiptap/html and extensions**

```bash
npm install @tiptap/html @tiptap/pm @tiptap/core @tiptap/starter-kit @tiptap/extension-heading -w packages/server
```

Note: `@tiptap/html` needs `@tiptap/core` and `@tiptap/pm` as peer dependencies.

**Step 2: Install turndown**

```bash
npm install turndown -w packages/server
npm install @types/turndown -D -w packages/server
```

**Step 3: Verify license compatibility**

Check each new dependency's license in `node_modules/{package}/package.json`. All TipTap packages are MIT. Turndown is MIT. Update `docs/dependency-licenses.md`.

**Step 4: Commit**

```
feat(export): install @tiptap/html and turndown server dependencies
```

---

## Task 5: Server Editor Extensions + Divergence Test

**Files:**
- Create: `packages/server/src/export/editorExtensions.ts`
- Create: `packages/server/src/__tests__/editorExtensions.test.ts`

**Step 1: Write the divergence test**

Create `packages/server/src/__tests__/editorExtensions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateHTML } from "@tiptap/html";
import { serverEditorExtensions } from "../export/editorExtensions";

// This document exercises the core node types the editor supports.
const referenceTipTapDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", marks: [{ type: "bold" }], text: "world" },
      ],
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "A heading" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Item one" }],
            },
          ],
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A quote" }],
        },
      ],
    },
  ],
};

describe("server editor extensions", () => {
  it("produces valid HTML from a reference TipTap document", () => {
    const html = generateHTML(referenceTipTapDoc, serverEditorExtensions);

    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<h3>A heading</h3>");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote>");
  });

  it("matches the client extension configuration", async () => {
    // Dynamic import to verify both lists configure the same extensions.
    // We can't do deep equality on extension instances, but we can verify
    // they produce identical HTML for the same input.
    const { editorExtensions: clientExtensions } = await import(
      "../../../client/src/editorExtensions"
    );
    const serverHtml = generateHTML(referenceTipTapDoc, serverEditorExtensions);
    const clientHtml = generateHTML(referenceTipTapDoc, clientExtensions);

    expect(serverHtml).toBe(clientHtml);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -w packages/server -- --run editorExtensions`

Expected: FAIL — `../export/editorExtensions` doesn't exist yet.

**Step 3: Create the server editor extensions file**

Create `packages/server/src/export/editorExtensions.ts`:

```typescript
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";

/**
 * Server-side TipTap extension list for generateHTML().
 * Must match the client's editorExtensions.ts — a test verifies
 * both produce identical output for a reference document.
 */
export const serverEditorExtensions = [
  StarterKit.configure({
    heading: false,
  }),
  Heading.configure({
    levels: [3, 4, 5],
  }),
];
```

**Step 4: Run test to verify it passes**

Run: `npm test -w packages/server -- --run editorExtensions`

Expected: PASS

**Step 5: Commit**

```
feat(export): add server editor extensions with divergence test
```

---

## Task 6: Export Renderers

**Files:**
- Create: `packages/server/src/export/export.renderers.ts`
- Create: `packages/server/src/__tests__/export.renderers.test.ts`

**Step 1: Write renderer tests**

Create `packages/server/src/__tests__/export.renderers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderHtml, renderMarkdown, renderPlainText } from "../export/export.renderers";

const sampleChapters = [
  {
    id: "ch-1",
    title: "The Beginning",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "It was a dark and stormy night." }],
        },
      ],
    },
    sort_order: 0,
  },
  {
    id: "ch-2",
    title: "The Middle",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "The plot thickened." }],
        },
      ],
    },
    sort_order: 1,
  },
];

const projectInfo = {
  title: "My Novel",
  author_name: "Jane Doe",
  slug: "my-novel",
};

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
    const html = renderHtml(
      { ...projectInfo, author_name: null },
      sampleChapters,
      { includeToc: false },
    );

    expect(html).not.toContain("Jane Doe");
    expect(html).not.toContain("class=\"author\"");
  });

  it("handles chapters with null content", () => {
    const chapters = [{ id: "ch-1", title: "Empty", content: null, sort_order: 0 }];
    const html = renderHtml(projectInfo, chapters, { includeToc: false });

    expect(html).toContain("Empty");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("handles zero chapters (title-page-only)", () => {
    const html = renderHtml(projectInfo, [], { includeToc: true });

    expect(html).toContain("<title>My Novel</title>");
    expect(html).toContain("Jane Doe");
    expect(html).not.toContain("Table of Contents");
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

  it("includes TOC with anchor links", () => {
    const md = renderMarkdown(projectInfo, sampleChapters, { includeToc: true });

    expect(md).toContain("## Table of Contents");
    expect(md).toMatch(/\[The Beginning\]/);
    expect(md).toMatch(/\[The Middle\]/);
  });

  it("omits TOC when includeToc is false", () => {
    const md = renderMarkdown(projectInfo, sampleChapters, { includeToc: false });

    expect(md).not.toContain("Table of Contents");
  });

  it("omits author line when author_name is null", () => {
    const md = renderMarkdown(
      { ...projectInfo, author_name: null },
      sampleChapters,
      { includeToc: false },
    );

    expect(md).not.toContain("By");
  });

  it("handles zero chapters", () => {
    const md = renderMarkdown(projectInfo, [], { includeToc: true });

    expect(md).toContain("# My Novel");
    expect(md).not.toContain("Table of Contents");
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
    // Three blank lines = four newlines between chapter sections
    expect(text).toContain("\n\n\n\n");
  });

  it("omits author line when author_name is null", () => {
    const text = renderPlainText(
      { ...projectInfo, author_name: null },
      sampleChapters,
      { includeToc: false },
    );

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
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run export.renderers`

Expected: FAIL — module doesn't exist.

**Step 3: Implement renderers**

Create `packages/server/src/export/export.renderers.ts`:

```typescript
import { generateHTML } from "@tiptap/html";
import TurndownService from "turndown";
import { serverEditorExtensions } from "./editorExtensions";

export interface ExportProjectInfo {
  title: string;
  author_name: string | null;
  slug: string;
}

export interface ExportChapter {
  id: string;
  title: string;
  content: Record<string, unknown> | null;
  sort_order: number;
}

interface RenderOptions {
  includeToc: boolean;
}

function chapterContentToHtml(content: Record<string, unknown> | null): string {
  if (!content) return "";
  try {
    return generateHTML(content as Parameters<typeof generateHTML>[0], serverEditorExtensions);
  } catch {
    return "";
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/blockquote>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugifyAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- HTML Renderer ---

export function renderHtml(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: RenderOptions,
): string {
  const lines: string[] = [];

  lines.push("<!DOCTYPE html>");
  lines.push('<html lang="en">');
  lines.push("<head>");
  lines.push('  <meta charset="UTF-8">');
  lines.push(`  <title>${escapeHtml(project.title)}</title>`);
  lines.push("  <style>");
  lines.push("    body { font-family: Georgia, 'Times New Roman', serif; max-width: 680px; margin: 0 auto; padding: 2rem 1.5rem; line-height: 1.8; color: #1C1917; }");
  lines.push("    h1 { text-align: center; margin-bottom: 0.5em; font-size: 2em; }");
  lines.push("    .author { text-align: center; color: #555; margin-bottom: 3em; font-style: italic; }");
  lines.push("    .toc { margin-bottom: 3em; }");
  lines.push("    .toc h2 { font-size: 1.2em; margin-bottom: 0.5em; }");
  lines.push("    .toc ul { list-style: none; padding: 0; }");
  lines.push("    .toc li { margin-bottom: 0.3em; }");
  lines.push("    .toc a { color: #6B4720; text-decoration: none; }");
  lines.push("    .toc a:hover { text-decoration: underline; }");
  lines.push("    h2 { margin-top: 3em; font-size: 1.5em; }");
  lines.push("    .chapter-divider { text-align: center; margin: 3em 0; color: #999; letter-spacing: 0.5em; font-size: 0.8em; }");
  lines.push("    blockquote { border-left: 3px solid #d4c4a8; margin-left: 0; padding-left: 1.5em; color: #555; }");
  lines.push("    code { background: #f5f0e8; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }");
  lines.push("    pre { background: #f5f0e8; padding: 1em; border-radius: 5px; overflow-x: auto; }");
  lines.push("    pre code { background: none; padding: 0; }");
  lines.push("  </style>");
  lines.push("</head>");
  lines.push("<body>");

  // Title page
  lines.push(`  <h1>${escapeHtml(project.title)}</h1>`);
  if (project.author_name) {
    lines.push(`  <p class="author">${escapeHtml(project.author_name)}</p>`);
  }

  // Table of contents
  if (options.includeToc && chapters.length > 0) {
    lines.push('  <nav class="toc">');
    lines.push("    <h2>Table of Contents</h2>");
    lines.push("    <ul>");
    chapters.forEach((ch, i) => {
      lines.push(`      <li><a href="#chapter-${i}">${escapeHtml(ch.title)}</a></li>`);
    });
    lines.push("    </ul>");
    lines.push("  </nav>");
  }

  // Chapters
  chapters.forEach((ch, i) => {
    if (i > 0) {
      lines.push('  <div class="chapter-divider" aria-hidden="true">* * *</div>');
    }
    lines.push(`  <section id="chapter-${i}">`);
    lines.push(`    <h2>${escapeHtml(ch.title)}</h2>`);
    const html = chapterContentToHtml(ch.content);
    if (html) {
      lines.push(`    ${html}`);
    }
    lines.push("  </section>");
  });

  lines.push("</body>");
  lines.push("</html>");

  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Markdown Renderer ---

export function renderMarkdown(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: RenderOptions,
): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  const parts: string[] = [];

  // Title
  parts.push(`# ${project.title}`);
  parts.push("");

  // Author
  if (project.author_name) {
    parts.push(`*By ${project.author_name}*`);
    parts.push("");
  }

  // Table of contents
  if (options.includeToc && chapters.length > 0) {
    parts.push("## Table of Contents");
    parts.push("");
    for (const ch of chapters) {
      const anchor = slugifyAnchor(ch.title);
      parts.push(`- [${ch.title}](#${anchor})`);
    }
    parts.push("");
    parts.push("---");
    parts.push("");
  }

  // Chapters
  chapters.forEach((ch, i) => {
    if (i > 0) {
      parts.push("---");
      parts.push("");
    }
    parts.push(`## ${ch.title}`);
    parts.push("");
    const html = chapterContentToHtml(ch.content);
    if (html) {
      const md = turndown.turndown(html);
      parts.push(md);
      parts.push("");
    }
  });

  return parts.join("\n");
}

// --- Plain Text Renderer ---

export function renderPlainText(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: RenderOptions,
): string {
  const parts: string[] = [];

  // Title page
  parts.push(project.title.toUpperCase());
  if (project.author_name) {
    parts.push(`by ${project.author_name}`);
  }
  parts.push("");
  parts.push("");

  // Table of contents
  if (options.includeToc && chapters.length > 0) {
    parts.push("Contents");
    parts.push("");
    for (const ch of chapters) {
      parts.push(`  ${ch.title}`);
    }
    parts.push("");
    parts.push("");
  }

  // Chapters
  chapters.forEach((ch, i) => {
    if (i > 0) {
      parts.push("");
      parts.push("");
      parts.push("");
    }
    parts.push(ch.title);
    parts.push("");
    const html = chapterContentToHtml(ch.content);
    if (html) {
      const text = stripHtmlTags(html);
      if (text) {
        parts.push(text);
      }
    }
  });

  return parts.join("\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run export.renderers`

Expected: PASS

**Step 5: Commit**

```
feat(export): implement HTML, Markdown, and plain text renderers
```

---

## Task 7: Export Zod Schema

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/schemas.test.ts`

**Step 1: Write failing test for export schema**

In `packages/shared/src/__tests__/schemas.test.ts`, add:

```typescript
import { ExportSchema } from "../schemas";

describe("ExportSchema", () => {
  it("accepts valid export config with all fields", () => {
    const result = ExportSchema.safeParse({
      format: "html",
      include_toc: true,
      chapter_ids: ["550e8400-e29b-41d4-a716-446655440000"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal config (format only)", () => {
    const result = ExportSchema.safeParse({ format: "markdown" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.include_toc).toBe(true);
    }
  });

  it("rejects invalid format", () => {
    const result = ExportSchema.safeParse({ format: "pdf" });
    expect(result.success).toBe(false);
  });

  it("rejects empty chapter_ids array", () => {
    const result = ExportSchema.safeParse({ format: "html", chapter_ids: [] });
    expect(result.success).toBe(false);
  });

  it("accepts plaintext format", () => {
    const result = ExportSchema.safeParse({ format: "plaintext" });
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -w packages/shared -- --run schemas`

Expected: FAIL — `ExportSchema` doesn't exist.

**Step 3: Add ExportSchema**

In `packages/shared/src/schemas.ts`, add:

```typescript
export const ExportFormat = z.enum(["html", "markdown", "plaintext"]);

export const ExportSchema = z.object({
  format: ExportFormat,
  include_toc: z.boolean().default(true),
  chapter_ids: z.array(z.string().uuid()).min(1).optional(),
});
```

**Step 4: Export from index.ts**

In `packages/shared/src/index.ts`, add `ExportSchema, ExportFormat` to the schemas export.

**Step 5: Run test to verify it passes**

Run: `npm test -w packages/shared -- --run schemas`

Expected: PASS

**Step 6: Commit**

```
feat(export): add ExportSchema validation to shared package
```

---

## Task 8: Export Service

**Files:**
- Create: `packages/server/src/export/export.service.ts`
- Create: `packages/server/src/__tests__/export.service.test.ts`

**Step 1: Write failing tests**

Create `packages/server/src/__tests__/export.service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

async function createProjectWithChapters() {
  const createRes = await request(t.app)
    .post("/api/projects")
    .send({ title: "Export Test", mode: "fiction" });
  const slug = createRes.body.slug;

  // Get the initial chapter
  const getRes = await request(t.app).get(`/api/projects/${slug}`);
  const chapter1Id = getRes.body.chapters[0].id;

  // Add content to first chapter
  await request(t.app)
    .patch(`/api/chapters/${chapter1Id}`)
    .send({
      title: "Chapter One",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "First chapter content." }] },
        ],
      },
    });

  // Create second chapter
  const ch2Res = await request(t.app).post(`/api/projects/${slug}/chapters`);
  await request(t.app)
    .patch(`/api/chapters/${ch2Res.body.id}`)
    .send({
      title: "Chapter Two",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Second chapter content." }] },
        ],
      },
    });

  return { slug, chapter1Id, chapter2Id: ch2Res.body.id };
}

describe("POST /api/projects/:slug/export", () => {
  it("exports all chapters as HTML", async () => {
    const { slug } = await createProjectWithChapters();

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "html" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-disposition"]).toContain(`${slug}.html`);
    expect(res.text).toContain("<!DOCTYPE html>");
    expect(res.text).toContain("Chapter One");
    expect(res.text).toContain("First chapter content.");
  });

  it("exports as Markdown", async () => {
    const { slug } = await createProjectWithChapters();

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "markdown" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.text).toContain("# Export Test");
    expect(res.text).toContain("## Chapter One");
  });

  it("exports as plain text", async () => {
    const { slug } = await createProjectWithChapters();

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "plaintext" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("EXPORT TEST");
    expect(res.text).toContain("Chapter One");
  });

  it("exports only selected chapters", async () => {
    const { slug, chapter1Id } = await createProjectWithChapters();

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "html", chapter_ids: [chapter1Id] });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Chapter One");
    expect(res.text).not.toContain("Chapter Two");
  });

  it("silently omits soft-deleted chapters from chapter_ids", async () => {
    const { slug, chapter1Id, chapter2Id } = await createProjectWithChapters();

    // Delete chapter 2
    await request(t.app).delete(`/api/chapters/${chapter2Id}`);

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "html", chapter_ids: [chapter1Id, chapter2Id] });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Chapter One");
    expect(res.text).not.toContain("Chapter Two");
  });

  it("returns 400 when all specified chapters are deleted", async () => {
    const { slug, chapter1Id } = await createProjectWithChapters();

    await request(t.app).delete(`/api/chapters/${chapter1Id}`);

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "html", chapter_ids: [chapter1Id] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EXPORT_NO_CHAPTERS");
  });

  it("exports title-page-only when project has no chapters", async () => {
    const { slug, chapter1Id, chapter2Id } = await createProjectWithChapters();

    // Delete all chapters
    await request(t.app).delete(`/api/chapters/${chapter1Id}`);
    await request(t.app).delete(`/api/chapters/${chapter2Id}`);

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "html" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Export Test");
    expect(res.text).toContain("<!DOCTYPE html>");
  });

  it("returns 400 for invalid format", async () => {
    const { slug } = await createProjectWithChapters();

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "pdf" });

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app)
      .post("/api/projects/nonexistent/export")
      .send({ format: "html" });

    expect(res.status).toBe(404);
  });

  it("returns 404 for soft-deleted project", async () => {
    const { slug } = await createProjectWithChapters();
    await request(t.app).delete(`/api/projects/${slug}`);

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "html" });

    expect(res.status).toBe(404);
  });

  it("includes author_name in export when set", async () => {
    const { slug } = await createProjectWithChapters();
    await request(t.app)
      .patch(`/api/projects/${slug}`)
      .send({ author_name: "Test Author" });

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "html" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Test Author");
  });

  it("omits TOC when include_toc is false", async () => {
    const { slug } = await createProjectWithChapters();

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "html", include_toc: false });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Table of Contents");
  });

  it("defaults include_toc to true", async () => {
    const { slug } = await createProjectWithChapters();

    const res = await request(t.app)
      .post(`/api/projects/${slug}/export`)
      .send({ format: "html" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Table of Contents");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run export.service`

Expected: FAIL — route doesn't exist, 404 for all.

**Step 3: Implement export service**

Create `packages/server/src/export/export.service.ts`:

```typescript
import { ExportSchema } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import {
  renderHtml,
  renderMarkdown,
  renderPlainText,
  type ExportProjectInfo,
  type ExportChapter,
} from "./export.renderers";

export type ExportFormat = "html" | "markdown" | "plaintext";

interface ExportResult {
  content: string;
  contentType: string;
  filename: string;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  html: "text/html; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  plaintext: "text/plain; charset=utf-8",
};

const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  html: "html",
  markdown: "md",
  plaintext: "txt",
};

export async function exportProject(
  slug: string,
  body: unknown,
): Promise<
  | { result: ExportResult }
  | { validationError: string }
  | { notFound: true }
  | { noChapters: true }
> {
  const parsed = ExportSchema.safeParse(body);
  if (!parsed.success) {
    return { validationError: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { format, include_toc, chapter_ids } = parsed.data;

  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return { notFound: true };

  // Gather chapters
  let chapters = await store.listChaptersByProject(project.id);

  if (chapter_ids) {
    // Filter to selected chapters, preserving sort_order
    const idSet = new Set(chapter_ids);
    chapters = chapters.filter((ch) => idSet.has(ch.id));

    if (chapters.length === 0) {
      return { noChapters: true };
    }
  }

  // Prepare data for renderers
  const projectInfo: ExportProjectInfo = {
    title: project.title,
    author_name: project.author_name,
    slug: project.slug,
  };

  const exportChapters: ExportChapter[] = chapters.map((ch) => ({
    id: ch.id,
    title: ch.title,
    content: ch.content,
    sort_order: ch.sort_order,
  }));

  const options = { includeToc: include_toc };

  // Render
  let content: string;
  switch (format) {
    case "html":
      content = renderHtml(projectInfo, exportChapters, options);
      break;
    case "markdown":
      content = renderMarkdown(projectInfo, exportChapters, options);
      break;
    case "plaintext":
      content = renderPlainText(projectInfo, exportChapters, options);
      break;
  }

  const ext = FILE_EXTENSIONS[format];
  const filename = `${project.slug || "export"}.${ext}`;

  return {
    result: {
      content,
      contentType: CONTENT_TYPES[format],
      filename,
    },
  };
}
```

**Step 4: Move to Task 9 for routes (tests depend on routes being wired up)**

---

## Task 9: Export Routes and App Registration

**Files:**
- Create: `packages/server/src/export/export.routes.ts`
- Modify: `packages/server/src/app.ts`

**Step 1: Create export routes**

Create `packages/server/src/export/export.routes.ts`:

```typescript
import { Router } from "express";
import { asyncHandler } from "../app";
import * as ExportService from "./export.service";

export function exportRouter(): Router {
  const router = Router();

  router.post(
    "/:slug/export",
    asyncHandler(async (req, res) => {
      const result = await ExportService.exportProject(
        req.params.slug as string,
        req.body,
      );

      if ("validationError" in result) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: result.validationError },
        });
        return;
      }

      if ("notFound" in result) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      if ("noChapters" in result) {
        res.status(400).json({
          error: {
            code: "EXPORT_NO_CHAPTERS",
            message: "No chapters available for export.",
          },
        });
        return;
      }

      const { content, contentType, filename } = result.result;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(content);
    }),
  );

  return router;
}
```

**Step 2: Register in app.ts**

In `packages/server/src/app.ts`, add import and registration:

```typescript
import { exportRouter } from "./export/export.routes";
```

Add after the settings router line:

```typescript
app.use("/api/projects", exportRouter());
```

**Step 3: Run the export service tests**

Run: `npm test -w packages/server -- --run export.service`

Expected: PASS

**Step 4: Run full server test suite**

Run: `npm test -w packages/server -- --run`

Expected: PASS — no regressions.

**Step 5: Commit**

```
feat(export): add export routes and service with full integration tests
```

---

## Task 10: Client API Method and Export Strings

**Files:**
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/strings.ts`

**Step 1: Add export API method**

In `packages/client/src/api/client.ts`, add to `api.projects`:

```typescript
export: async (
  slug: string,
  config: {
    format: "html" | "markdown" | "plaintext";
    include_toc?: boolean;
    chapter_ids?: string[];
  },
): Promise<Blob> => {
  const res = await fetch(`${BASE}/projects/${slug}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    let message = `Export failed: ${res.status}`;
    try {
      const body = (await res.json()) as ApiError;
      message = body.error?.message ?? message;
    } catch {
      // Response body wasn't JSON
    }
    throw new ApiRequestError(message, res.status);
  }

  return res.blob();
},
```

Note: This method bypasses `apiFetch` because it returns a `Blob`, not JSON.

**Step 2: Add export strings**

In `packages/client/src/strings.ts`, add after the `projectSettings` section:

```typescript
export: {
  buttonLabel: "Export",
  dialogTitle: "Export Manuscript",
  formatLabel: "Format",
  formatHtml: "HTML",
  formatMarkdown: "Markdown",
  formatPlainText: "Plain Text",
  includeTocLabel: "Include table of contents",
  chapterSelectionAll: "All chapters",
  chapterSelectionChoose: "Select specific chapters...",
  exportButton: "Export",
  exportingButton: "Exporting...",
  cancelButton: "Cancel",
  success: (title: string) => `Exported "${title}"`,
  errorFailed: "Export failed. Please try again.",
  close: "Close export dialog",
},
```

**Step 3: Commit**

```
feat(export): add client export API method and UI strings
```

---

## Task 11: ExportDialog Component

**Files:**
- Create: `packages/client/src/components/ExportDialog.tsx`
- Create: `packages/client/src/__tests__/ExportDialog.test.tsx`

**Step 1: Write the test**

Create `packages/client/src/__tests__/ExportDialog.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportDialog } from "../components/ExportDialog";
import { STRINGS } from "../strings";

const mockChapters = [
  { id: "ch-1", title: "Chapter One", sort_order: 0 },
  { id: "ch-2", title: "Chapter Two", sort_order: 1 },
];

describe("ExportDialog", () => {
  const defaultProps = {
    open: true,
    projectSlug: "test-project",
    chapters: mockChapters,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders format options", () => {
    render(<ExportDialog {...defaultProps} />);

    expect(screen.getByLabelText(STRINGS.export.formatHtml)).toBeInTheDocument();
    expect(screen.getByLabelText(STRINGS.export.formatMarkdown)).toBeInTheDocument();
    expect(screen.getByLabelText(STRINGS.export.formatPlainText)).toBeInTheDocument();
  });

  it("renders TOC checkbox checked by default", () => {
    render(<ExportDialog {...defaultProps} />);

    const checkbox = screen.getByLabelText(STRINGS.export.includeTocLabel);
    expect(checkbox).toBeChecked();
  });

  it("defaults to all chapters selected", () => {
    render(<ExportDialog {...defaultProps} />);

    // The "Select specific chapters..." link should be visible
    expect(screen.getByText(STRINGS.export.chapterSelectionChoose)).toBeInTheDocument();
  });

  it("shows chapter checklist when clicking select specific", async () => {
    const user = userEvent.setup();
    render(<ExportDialog {...defaultProps} />);

    await user.click(screen.getByText(STRINGS.export.chapterSelectionChoose));

    expect(screen.getByLabelText("Chapter One")).toBeInTheDocument();
    expect(screen.getByLabelText("Chapter Two")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<ExportDialog {...defaultProps} open={false} />);

    expect(screen.queryByText(STRINGS.export.dialogTitle)).not.toBeInTheDocument();
  });

  it("calls onClose when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExportDialog {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByText(STRINGS.export.cancelButton));

    expect(onClose).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- --run ExportDialog`

Expected: FAIL — component doesn't exist.

**Step 3: Implement ExportDialog**

Create `packages/client/src/components/ExportDialog.tsx`:

```typescript
import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { STRINGS } from "../strings";

type ExportFormat = "html" | "markdown" | "plaintext";

interface ExportDialogProps {
  open: boolean;
  projectSlug: string;
  chapters: Array<{ id: string; title: string; sort_order: number }>;
  onClose: () => void;
}

export function ExportDialog({ open, projectSlug, chapters, onClose }: ExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<ExportFormat>("html");
  const [includeToc, setIncludeToc] = useState(true);
  const [selectingChapters, setSelectingChapters] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setFormat("html");
      setIncludeToc(true);
      setSelectingChapters(false);
      setSelectedChapterIds(new Set(chapters.map((ch) => ch.id)));
      setExporting(false);
      setError(null);
    }
  }, [open, chapters]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          // happy-dom does not support showModal
        }
      }
    } else {
      try {
        dialog.close();
      } catch {
        // happy-dom does not support close
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  function toggleChapter(id: string) {
    setSelectedChapterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleExport() {
    setExporting(true);
    setError(null);

    try {
      const config: Parameters<typeof api.projects.export>[1] = {
        format,
        include_toc: includeToc,
      };

      // Only send chapter_ids if the user explicitly selected specific chapters
      if (selectingChapters) {
        config.chapter_ids = chapters
          .filter((ch) => selectedChapterIds.has(ch.id))
          .map((ch) => ch.id);
      }

      const blob = await api.projects.export(projectSlug, config);

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "html" ? "html" : format === "markdown" ? "md" : "txt";
      a.download = `${projectSlug}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onClose();
    } catch {
      setError(STRINGS.export.errorFailed);
    } finally {
      setExporting(false);
    }
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label={STRINGS.export.dialogTitle}
      className="fixed inset-0 z-50 flex items-center justify-center bg-transparent m-0 p-0 w-full h-full border-none backdrop:bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rounded-xl bg-bg-primary p-8 shadow-xl max-w-sm w-full mx-auto mt-[15vh] border border-border/60">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-text-primary font-semibold text-base">
            {STRINGS.export.dialogTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary rounded-md p-1 focus:outline-none focus:ring-2 focus:ring-focus-ring"
            aria-label={STRINGS.export.close}
          >
            &#x2715;
          </button>
        </div>

        {error && (
          <p className="mb-4 text-sm text-status-error" role="alert">
            {error}
          </p>
        )}

        {/* Format selector */}
        <fieldset className="mb-5">
          <legend className="text-sm font-medium text-text-secondary mb-2 font-sans">
            {STRINGS.export.formatLabel}
          </legend>
          <div className="flex gap-3">
            {(
              [
                ["html", STRINGS.export.formatHtml],
                ["markdown", STRINGS.export.formatMarkdown],
                ["plaintext", STRINGS.export.formatPlainText],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="export-format"
                  value={value}
                  checked={format === value}
                  onChange={() => setFormat(value)}
                  className="accent-accent"
                />
                <span className="text-sm text-text-primary font-sans">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* TOC checkbox */}
        <label className="flex items-center gap-2 mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={includeToc}
            onChange={(e) => setIncludeToc(e.target.checked)}
            className="accent-accent"
          />
          <span className="text-sm text-text-primary font-sans">
            {STRINGS.export.includeTocLabel}
          </span>
        </label>

        {/* Chapter selection */}
        <div className="mb-6">
          {!selectingChapters ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary font-sans">
                {STRINGS.export.chapterSelectionAll}
              </span>
              <button
                type="button"
                onClick={() => setSelectingChapters(true)}
                className="text-sm text-accent hover:underline font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
              >
                {STRINGS.export.chapterSelectionChoose}
              </button>
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-border/40 rounded-lg p-3">
              {chapters.map((ch) => (
                <label key={ch.id} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedChapterIds.has(ch.id)}
                    onChange={() => toggleChapter(ch.id)}
                    className="accent-accent"
                  />
                  <span className="text-sm text-text-primary font-sans">{ch.title}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {STRINGS.export.cancelButton}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            aria-busy={exporting}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring shadow-sm disabled:opacity-60"
          >
            {exporting ? STRINGS.export.exportingButton : STRINGS.export.exportButton}
          </button>
        </div>
      </div>
    </dialog>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client -- --run ExportDialog`

Expected: PASS

**Step 5: Commit**

```
feat(export): add ExportDialog component
```

---

## Task 12: Wire ExportDialog into EditorPage

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`

**Step 1: Add export state and button**

In `packages/client/src/pages/EditorPage.tsx`:

1. Import ExportDialog:
```typescript
import { ExportDialog } from "../components/ExportDialog";
```

2. Add state:
```typescript
const [exportDialogOpen, setExportDialogOpen] = useState(false);
```

3. Add the Export button in the header's right side `div` (the one containing ViewModeNav and settings gear), between the ViewModeNav and the settings button:

```tsx
<button
  onClick={() => setExportDialogOpen(true)}
  className="text-sm text-text-muted hover:text-text-secondary rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus-ring"
>
  {STRINGS.export.buttonLabel}
</button>
```

4. Add the ExportDialog component at the bottom with other dialogs:

```tsx
{project && (
  <ExportDialog
    open={exportDialogOpen}
    projectSlug={project.slug}
    chapters={project.chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      sort_order: ch.sort_order,
    }))}
    onClose={() => setExportDialogOpen(false)}
  />
)}
```

**Step 2: Run client tests**

Run: `npm test -w packages/client -- --run`

Expected: PASS

**Step 3: Commit**

```
feat(export): wire ExportDialog into EditorPage header
```

---

## Task 13: Full Test Suite and Coverage

**Step 1: Run full test suite**

Run: `make test`

Expected: PASS across all packages.

**Step 2: Run coverage**

Run: `make cover`

Expected: Coverage meets thresholds (95% statements, 85% branches, 90% functions, 95% lines). If coverage drops below thresholds, write additional tests for uncovered branches.

**Step 3: Run lint and format**

Run: `make lint && make format`

Fix any issues.

**Step 4: Commit any fixes**

```
test(export): ensure coverage thresholds met
```

---

## Task 14: E2E Tests

**Files:**
- Create: `e2e/export.spec.ts`

**Step 1: Write the e2e test**

Create `e2e/export.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

let projectSlug: string;

test.beforeEach(async ({ request }) => {
  const res = await request.post("/api/projects", {
    data: { title: "Export E2E Test", mode: "fiction" },
  });
  const body = await res.json();
  projectSlug = body.slug;

  // Get initial chapter and add content
  const getRes = await request.get(`/api/projects/${projectSlug}`);
  const project = await getRes.json();
  const chapterId = project.chapters[0].id;

  await request.patch(`/api/chapters/${chapterId}`, {
    data: {
      title: "First Chapter",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hello from e2e." }] },
        ],
      },
    },
  });
});

test.afterEach(async ({ request }) => {
  await request.delete(`/api/projects/${projectSlug}`);
});

test("exports manuscript as HTML via dialog", async ({ page }) => {
  await page.goto(`/project/${projectSlug}`);
  await page.waitForSelector("[data-testid='editor-content']", { timeout: 10000 }).catch(() => {
    // Editor might use a different selector — wait for the page to load
  });

  // Click Export button
  await page.getByText("Export").click();

  // Dialog should open
  await expect(page.getByText("Export Manuscript")).toBeVisible();

  // HTML should be selected by default
  const htmlRadio = page.getByLabel("HTML");
  await expect(htmlRadio).toBeChecked();

  // Start download
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toContain(".html");
});

test("export dialog is accessible", async ({ page }) => {
  await page.goto(`/project/${projectSlug}`);
  await page.getByText("Export").click();
  await expect(page.getByText("Export Manuscript")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast"]) // Tailwind v4 oklab() false positives
    .analyze();

  expect(results.violations).toEqual([]);
});
```

**Step 2: Run e2e tests**

Run: `make e2e`

Expected: PASS

**Step 3: Commit**

```
test(export): add e2e tests for export dialog and download
```

---

## Task 15: Update Dependency Licenses

**Files:**
- Modify: `docs/dependency-licenses.md`

**Step 1: Check licenses**

Verify licenses for all new dependencies:
- `@tiptap/html` — MIT
- `@tiptap/core` — MIT
- `@tiptap/pm` — MIT
- `@tiptap/starter-kit` — MIT
- `@tiptap/extension-heading` — MIT
- `turndown` — MIT
- `@types/turndown` — MIT

**Step 2: Update docs/dependency-licenses.md**

Add entries for the new server-side dependencies that aren't already listed from the client.

**Step 3: Commit**

```
docs(export): update dependency licenses for export dependencies
```

---

## Task Summary

| Task | Description | Type |
|------|-------------|------|
| 1 | Migration: `author_name` column | Backend |
| 2 | Wire `author_name` through service/routes | Backend |
| 3 | Add `author_name` to ProjectSettingsDialog | Frontend |
| 4 | Install server dependencies | Infrastructure |
| 5 | Server editor extensions + divergence test | Backend |
| 6 | Export renderers (HTML, Markdown, plain text) | Backend |
| 7 | Export Zod schema | Shared |
| 8 | Export service | Backend |
| 9 | Export routes + app registration | Backend |
| 10 | Client API method + export strings | Frontend |
| 11 | ExportDialog component | Frontend |
| 12 | Wire ExportDialog into EditorPage | Frontend |
| 13 | Full test suite + coverage | Quality |
| 14 | E2E tests | Quality |
| 15 | Update dependency licenses | Docs |

Tasks 1–3 can be done independently of 4–9. Tasks 10–12 depend on the server being complete. Tasks 13–15 are final verification.
