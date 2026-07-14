import { describe, it, expect } from "vitest";
import { generateHTML } from "@tiptap/html";
import { editorExtensions, renderEditorHtml } from "../editorExtensions";

// A reference TipTap document exercising every node type the shared
// extension config is expected to render: bold mark, heading (level 3),
// bullet list, and blockquote.
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

const notedDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Marcus drew his sword",
          marks: [{ type: "note", attrs: { text: "SECRET" } }],
        },
      ],
    },
  ],
};

describe("shared editor extensions", () => {
  // Forcing pause, in the spirit of editorEntryPointSurface.test.ts (CLAUDE.md
  // §F-1). This array is consumed by the SERVER export renderer and the client
  // preview/snapshot views, not just the editor — so adding an extension here
  // changes what ships to a beta reader. Nothing turned red when the note mark
  // was added, and it leaked private note text into every HTML export.
  //
  // If this test fails you have added or removed an extension. Before updating
  // the list, answer: does this extension render into output? If it is
  // editor-only (like `note`), it MUST be stripped inside renderEditorHtml()
  // below — that is the only route from TipTap JSON to any rendered surface.
  it("pins the extension set consumed by export, preview, and snapshot view", () => {
    expect(editorExtensions.map((e) => e.name)).toEqual(["starterKit", "heading", "image", "note"]);
  });

  it("renders a reference TipTap document to valid HTML", () => {
    const html = generateHTML(referenceTipTapDoc, editorExtensions);
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<h3>A heading</h3>");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote>");
  });
});

describe("renderEditorHtml", () => {
  it("renders document content the same way generateHTML does", () => {
    const html = renderEditorHtml(referenceTipTapDoc);
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<h3>A heading</h3>");
  });

  it("strips editor-only note marks — neither the note text nor the highlight reaches output", () => {
    const html = renderEditorHtml(notedDoc);
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("note-highlight");
    expect(html).not.toContain("data-note");
    expect(html).toContain("Marcus drew his sword");
  });

  it("leaves the caller's document untouched", () => {
    const doc = structuredClone(notedDoc);
    renderEditorHtml(doc);
    expect(doc).toEqual(notedDoc);
  });
});
