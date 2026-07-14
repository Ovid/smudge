import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/html";
import { editorExtensions } from "../editorExtensions";
import { extractNotes, stripNoteMarks } from "../tiptap-notes";

const noted = (noteText: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Marcus drew his sword",
          marks: [{ type: "note", attrs: { text: noteText } }],
        },
      ],
    },
  ],
});

const notedDoc = noted("check the weapon");

describe("note mark", () => {
  it("renders a noted range as a highlight span carrying the note text", () => {
    const html = generateHTML(notedDoc, editorExtensions);
    expect(html).toContain("note-highlight");
    expect(html).toContain('data-note="check the weapon"');
    expect(html).toContain("Marcus drew his sword");
  });

  it("emits neither the highlight nor the note text once stripped", () => {
    const html = generateHTML(stripNoteMarks(notedDoc), editorExtensions);
    expect(html).not.toContain("note-highlight");
    expect(html).not.toContain("check the weapon");
    expect(html).toContain("Marcus drew his sword");
  });

  // parseHTML is the clipboard-paste ingress: ProseMirror serializes the
  // clipboard as HTML, so copy/paste within the editor is an HTML round trip.
  it("survives an HTML round trip", () => {
    const back = generateJSON(generateHTML(notedDoc, editorExtensions), editorExtensions);
    expect(extractNotes(back)).toEqual([
      { note: "check the weapon", excerpt: "Marcus drew his sword" },
    ]);
  });

  it("survives an HTML round trip when the note text is empty", () => {
    const back = generateJSON(generateHTML(noted(""), editorExtensions), editorExtensions);
    expect(extractNotes(back)).toEqual([{ note: "", excerpt: "Marcus drew his sword" }]);
  });
});
