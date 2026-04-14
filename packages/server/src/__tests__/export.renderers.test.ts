import { describe, it, expect } from "vitest";
import { renderHtml, renderMarkdown, renderPlainText } from "../export/export.renderers";

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

  it("deduplicates TOC anchors for chapters with identical titles", () => {
    const dupeChapters = [
      { id: "ch-1", title: "Interlude", content: null, sort_order: 0 },
      { id: "ch-2", title: "Interlude", content: null, sort_order: 1 },
      { id: "ch-3", title: "Interlude", content: null, sort_order: 2 },
    ];
    const md = renderMarkdown(projectInfo, dupeChapters, { includeToc: true });
    expect(md).toContain("[Interlude](#interlude)");
    expect(md).toContain("[Interlude](#interlude-1)");
    expect(md).toContain("[Interlude](#interlude-2)");
  });

  it("handles non-Latin chapter titles in TOC anchors", () => {
    const cjkChapters = [{ id: "ch-1", title: "\u7B2C\u4E00\u7AE0", content: null, sort_order: 0 }];
    const md = renderMarkdown(projectInfo, cjkChapters, { includeToc: true });
    expect(md).toMatch(/\[第一章\]\(#第一章\)/);
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
    // TOC link text is also escaped
    expect(md).toContain("[Chapter \\#1: The \\[Beginning\\]]");
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
});
