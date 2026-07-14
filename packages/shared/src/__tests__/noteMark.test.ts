import { describe, it, expect } from "vitest";
import { generateHTML } from "@tiptap/html";
import { editorExtensions } from "../editorExtensions";
import { stripNoteMarks } from "../tiptap-notes";

const notedDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Marcus drew his sword",
          marks: [{ type: "note", attrs: { text: "check the weapon" } }],
        },
      ],
    },
  ],
};

describe("note mark", () => {
  it("renders a noted range as a highlight span in the editor/HTML path", () => {
    const html = generateHTML(notedDoc, editorExtensions);
    expect(html).toContain("note-highlight");
    expect(html).toContain("Marcus drew his sword");
  });

  it("carries the note text in a data-note attribute", () => {
    expect(generateHTML(notedDoc, editorExtensions)).toContain(
      'data-note="check the weapon"',
    );
  });

  it("emits neither the highlight nor the note text once stripped", () => {
    const html = generateHTML(stripNoteMarks(notedDoc), editorExtensions);
    expect(html).not.toContain("note-highlight");
    expect(html).not.toContain("check the weapon");
    expect(html).toContain("Marcus drew his sword");
  });
});
