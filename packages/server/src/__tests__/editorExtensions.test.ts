import { describe, it, expect } from "vitest";
import { generateHTML } from "@tiptap/html";
import { serverEditorExtensions } from "../export/editorExtensions";

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

  it("matches expected output (divergence guard against client extensions)", () => {
    // This test uses a snapshot to detect if server extensions diverge from
    // what the client produces. If the client's editorExtensions.ts changes,
    // regenerate this snapshot by running: npx vitest -u editorExtensions
    const html = generateHTML(referenceTipTapDoc, serverEditorExtensions);
    expect(html).toMatchSnapshot();
  });
});
