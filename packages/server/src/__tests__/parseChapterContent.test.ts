import { describe, it, expect, vi } from "vitest";
import { parseChapterContent } from "../chapters/chapters.repository";
import { logger } from "../logger";

describe("parseChapterContent", () => {
  it("parses valid JSON string content into an object", () => {
    const chapter = {
      id: "abc",
      title: "Test",
      content: JSON.stringify({ type: "doc", content: [] }),
    };
    const result = parseChapterContent(chapter) as unknown as Record<string, unknown>;
    expect(result.content).toEqual({ type: "doc", content: [] });
    expect(result.content_corrupt).toBeUndefined();
    expect(result.id).toBe("abc");
    expect(result.title).toBe("Test");
  });

  it("returns null content with content_corrupt flag and logs error when JSON is corrupt", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const chapter = {
      id: "abc",
      title: "Test",
      content: "{invalid json!!!",
    };
    const result = parseChapterContent(chapter) as unknown as Record<string, unknown>;
    expect(result.content).toBeNull();
    expect(result.content_corrupt).toBe(true);
    expect(result.id).toBe("abc");
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chapter_id: "abc" }),
      "Corrupt JSON in chapter content",
    );
    errorSpy.mockRestore();
  });

  it("returns null when content is null", () => {
    const chapter = { id: "abc", title: "Test", content: null };
    const result = parseChapterContent(chapter);
    expect(result.content).toBeNull();
  });

  it("returns null when content is undefined", () => {
    const chapter = { id: "abc", title: "Test" };
    const result = parseChapterContent(chapter);
    expect(result.content).toBeNull();
  });

  it("passes through non-string content as-is", () => {
    const contentObj = { type: "doc", content: [] };
    const chapter = { id: "abc", title: "Test", content: contentObj };
    const result = parseChapterContent(chapter);
    expect(result.content).toBe(contentObj);
  });

  it("preserves all other chapter fields", () => {
    const chapter = {
      id: "abc",
      title: "Test",
      content: JSON.stringify({ type: "doc" }),
      word_count: 42,
      sort_order: 3,
      status: "outline",
    };
    const result = parseChapterContent(chapter) as unknown as Record<string, unknown>;
    expect(result.word_count).toBe(42);
    expect(result.sort_order).toBe(3);
    expect(result.status).toBe("outline");
  });
});

describe("parseChapterContent integration — corrupt DB content", () => {
  it("logs error with chapter id when DB has corrupt JSON", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const chapter = {
      id: "test-123",
      title: "Corrupt Chapter",
      content: "not valid json {{{",
      word_count: 0,
    };
    const result = parseChapterContent(chapter) as unknown as Record<string, unknown>;
    expect(result.content).toBeNull();
    expect(result.content_corrupt).toBe(true);
    expect(result.title).toBe("Corrupt Chapter");
    // Must log the chapter id so the corrupt row can be found
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chapter_id: "test-123" }),
      "Corrupt JSON in chapter content",
    );
    errorSpy.mockRestore();
  });

  it("logs error name but not the full error (to avoid leaking content snippets)", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const chapter = { id: "abc", title: "Test", content: "{invalid json!!!" };
    parseChapterContent(chapter);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ parseError: "SyntaxError" }),
      "Corrupt JSON in chapter content",
    );
    // Must NOT include the full err object (its message contains content snippets)
    const loggedObj = errorSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(loggedObj).not.toHaveProperty("err");
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// I6 (dedup review 2026-07-26): "valid JSON, wrong shape" degrades like a throw
// ---------------------------------------------------------------------------

describe('parseChapterContent — "valid JSON, wrong shape" (I6)', () => {
  // The guard exists at both sibling sites and never reached chapters:
  // a19e8aa (2026-04-17) added it to snapshots.service.ts and 5d3d495
  // (2026-07-26) added it to outtakes.repository.ts — its comment saying
  // "mirroring snapshots.service.ts", three months later, re-deriving the same
  // reasoning without extending it here.
  //
  // Guarding only the JSON.parse THROW let "42" / "[]" / "null" / '"text"'
  // through: they parse fine and returned e.g. `{ ...row, content: 42 }` with
  // NO content_corrupt flag. isCorruptChapter was then false, the row was
  // served as healthy, and the designed CORRUPT_CONTENT route could not fire.
  //
  // Reachability is a hand-edited DB, a restored backup, or a legacy row —
  // never the API, which validates through TipTapDocSchema. The degrade must
  // still be correct: this is the read path for content the writer cannot
  // otherwise recover.
  it.each([
    ["a number", "42"],
    ["an array", "[]"],
    ["a populated array", '[{"type":"doc"}]'],
    ["null", "null"],
    ["a string", '"just text"'],
    ["a boolean", "true"],
  ])("flags %s as corrupt rather than serving it as healthy", (_label, stored) => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const result = parseChapterContent({
      id: "abc",
      title: "Test",
      content: stored,
    }) as unknown as Record<string, unknown>;

    expect(result.content).toBeNull();
    expect(result.content_corrupt).toBe(true);
    expect(result.id).toBe("abc");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chapter_id: "abc" }),
      "Corrupt JSON in chapter content",
    );
    errorSpy.mockRestore();
  });

  it("still accepts a plain object, the only valid shape", () => {
    const result = parseChapterContent({
      id: "abc",
      title: "Test",
      content: '{"type":"doc","content":[]}',
    }) as unknown as Record<string, unknown>;
    expect(result.content).toEqual({ type: "doc", content: [] });
    expect(result.content_corrupt).toBeUndefined();
  });
});

describe("parseChapterContent — object-but-not-a-document is corrupt (F-10)", () => {
  // F-10: the gate was `isTipTapNode`, which accepts ANY object. Its two
  // sibling parsers had already rejected that predicate as insufficient and
  // moved to TipTapDocSchema — outtakes' comment says so in as many words —
  // leaving chapters, the manuscript table and the one with a designed
  // CORRUPT_CONTENT route, on the weakest check of the three.
  //
  // A stored `{"foo":1}` passed, was served as a healthy chapter with
  // `content_corrupt` unset, rendered as nothing, and the CORRUPT_CONTENT
  // route could never fire for it.
  it.each([
    ["a bare object with no type", '{"foo":1}'],
    ["an object whose type is not doc", '{"type":"paragraph","content":[]}'],
    ["a doc whose content is not an array", '{"type":"doc","content":5}'],
    ["a doc with a primitive where a node belongs", '{"type":"doc","content":[0]}'],
    ["a doc with a null child", '{"type":"doc","content":[null]}'],
  ])("flags %s as corrupt", (_label, stored) => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const result = parseChapterContent({
      id: "abc",
      title: "Test",
      content: stored,
    }) as unknown as Record<string, unknown>;

    expect(result.content).toBeNull();
    expect(result.content_corrupt).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chapter_id: "abc" }),
      "Corrupt JSON in chapter content",
    );
    errorSpy.mockRestore();
  });
});

describe("parseChapterContent — real manuscript shapes stay readable (F-10 safety net)", () => {
  // Safety net for F-10 (architecture report 2026-08-11), which tightens this
  // read path's corruption gate from `isTipTapNode` (any object) to the
  // stricter `TipTapDocSchema` its two sibling parsers already use.
  //
  // The upside of that change is that `{"foo":1}` stops being served as a
  // healthy chapter. The DOWNSIDE it must not have is any legitimate stored
  // manuscript newly reading as corrupt — this is the read path for content
  // the writer cannot otherwise recover, so a false positive here does not
  // degrade a feature, it makes a chapter unopenable. Every shape below is
  // content the editor genuinely produces and MUST keep parsing as healthy.
  //
  // These cases are the reason the fix cannot be waved through as "just swap
  // the predicate": TipTapDocSchema additionally enforces `type: "doc"` and
  // the MAX_TIPTAP_DEPTH walker, neither of which isTipTapNode checked.

  /** blockquote > bulletList > listItem > paragraph > text — legal, and deep. */
  function nestedDoc(depth: number) {
    let node: Record<string, unknown> = { type: "text", text: "deep" };
    for (let i = 0; i < depth; i++) {
      node = { type: "blockquote", content: [node] };
    }
    return { type: "doc", content: [node] };
  }

  const HEALTHY: Array<[string, unknown]> = [
    ["an empty document", { type: "doc" }],
    ["a document with an empty content array", { type: "doc", content: [] }],
    [
      "prose with marks",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "She said " },
              { type: "text", marks: [{ type: "italic" }], text: "nothing" },
              { type: "text", marks: [{ type: "bold" }], text: " at all." },
            ],
          },
        ],
      },
    ],
    [
      "headings and multiple blocks",
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Part One" }] },
          { type: "paragraph", content: [{ type: "text", text: "It began badly." }] },
          { type: "horizontalRule" },
        ],
      },
    ],
    [
      "an image node",
      {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "/api/images/2f1c9f6e-0000-4000-8000-000000000000", alt: "a map" },
          },
        ],
      },
    ],
    [
      "an editor-only note mark",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", marks: [{ type: "note", attrs: { note: "fix this" } }], text: "TK" },
            ],
          },
        ],
      },
    ],
    ["deep but legal nesting", nestedDoc(30)],
  ];

  it.each(HEALTHY)("keeps %s readable", (_label, doc) => {
    const result = parseChapterContent({
      id: "abc",
      title: "Test",
      content: JSON.stringify(doc),
    }) as unknown as Record<string, unknown>;

    expect(result.content).toEqual(doc);
    expect(result.content_corrupt).toBeUndefined();
  });
});
