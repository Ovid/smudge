import { describe, it, expect } from "vitest";
import { stripImageNodes } from "../tiptap-images";
describe("stripImageNodes", () => {
  it("drops image nodes but keeps surrounding content", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before" },
            { type: "image", attrs: { src: "/api/images/x.png" } },
            { type: "text", text: "after" },
          ],
        },
      ],
    };
    const json = JSON.stringify(stripImageNodes(doc));
    expect(json).not.toContain("image");
    expect(json).toContain("before");
    expect(json).toContain("after");
  });
  it("returns a doc even when everything was an image", () => {
    const doc = { type: "doc", content: [{ type: "image", attrs: { src: "/x" } }] };
    expect(stripImageNodes(doc)).toEqual({ type: "doc", content: [] });
  });
  it("returns an empty doc when the top-level node is itself an image", () => {
    expect(stripImageNodes({ type: "image" })).toEqual({ type: "doc", content: [] });
  });
  // TipTapDocSchema constrains TOP-LEVEL elements only (z.array(z.record(...)));
  // nested content[] is unvalidated, so the walker cannot assume child shape.
  it("survives a malformed child without throwing", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [null, 42, "x"] }] };
    expect(() => stripImageNodes(doc as Record<string, unknown>)).not.toThrow();
  });
  it("drops an array-wrapped child rather than letting its image survive", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [[{ type: "image", attrs: { src: "/x.png" } }]] }],
    };
    expect(JSON.stringify(stripImageNodes(doc as Record<string, unknown>))).not.toContain("image");
  });
  it("drops an over-deep subtree rather than returning it with images intact", () => {
    // Fail CLOSED at the cap, like stripNoteMarks / collectLeafBlocks /
    // validateTipTapDepth. Returning the subtree verbatim kept its images,
    // which is the one failure mode this walker exists to prevent.
    let node: Record<string, unknown> = { type: "image", attrs: { src: "/deep.png" } };
    for (let i = 0; i < 200; i++) node = { type: "paragraph", content: [node] };
    expect(JSON.stringify(stripImageNodes({ type: "doc", content: [node] }))).not.toContain(
      "image",
    );
  });
  it("caps recursion at MAX_TIPTAP_DEPTH without throwing", () => {
    let node: Record<string, unknown> = { type: "text", text: "x" };
    for (let i = 0; i < 200; i++) node = { type: "paragraph", content: [node] };
    expect(() => stripImageNodes({ type: "doc", content: [node] })).not.toThrow();
  });
});
