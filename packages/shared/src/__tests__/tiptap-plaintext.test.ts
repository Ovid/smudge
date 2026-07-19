import { describe, it, expect } from "vitest";
import { toPlainText } from "../tiptap-plaintext";
const doc = (content: unknown[]) => ({ type: "doc", content });
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
describe("toPlainText", () => {
  it("joins block-level nodes with a newline", () => {
    expect(toPlainText(doc([para("Hello"), para("World")]))).toBe("Hello\nWorld");
  });
  it("concatenates adjacent inline text without a separator", () => {
    expect(toPlainText(doc([{ type: "paragraph", content: [
      { type: "text", text: "foo" }, { type: "text", text: "bar" },
    ] }]))).toBe("foobar");
  });
  it("does not produce a phantom cross-block match", () => {
    expect(toPlainText(doc([para("Hello"), para("World")])).includes("oW")).toBe(false);
  });
  it("returns '' for null / empty doc", () => {
    expect(toPlainText(null)).toBe("");
    expect(toPlainText(doc([]))).toBe("");
  });
  it("caps recursion at MAX_TIPTAP_DEPTH without throwing", () => {
    let node: Record<string, unknown> = { type: "text", text: "deep" };
    for (let i = 0; i < 200; i++) node = { type: "paragraph", content: [node] };
    expect(() => toPlainText(doc([node]))).not.toThrow();
  });
});
