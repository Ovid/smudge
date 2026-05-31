import { describe, it, expect } from "vitest";
import { generateHTML } from "@tiptap/html";
import { editorExtensions } from "../editorExtensions";

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

describe("shared editor extensions", () => {
  it("renders a reference TipTap document to valid HTML", () => {
    const html = generateHTML(referenceTipTapDoc, editorExtensions);
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<h3>A heading</h3>");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote>");
  });
});
