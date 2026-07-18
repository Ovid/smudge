import { describe, it, expect } from "vitest";
import { renderSnapshotContent } from "../hooks/useSnapshotController";
import { STRINGS } from "../strings";

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

describe("renderSnapshotContent", () => {
  it("renders chapter content", () => {
    const html = renderSnapshotContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    });
    expect(html).toContain("Hello world");
  });

  it("strips note marks — the snapshot view is a rendered surface, not the editor", () => {
    const html = renderSnapshotContent(notedDoc);
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("note-highlight");
    expect(html).toContain("Marcus drew his sword");
  });

  it("falls back to an error paragraph on malformed content", () => {
    expect(renderSnapshotContent({ type: "no_such_node" })).toContain(
      STRINGS.snapshots.renderError,
    );
  });
});
