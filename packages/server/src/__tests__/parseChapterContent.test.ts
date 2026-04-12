import { describe, it, expect, vi } from "vitest";
import { parseChapterContent } from "../chapters/chapters.repository";

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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(errorSpy.mock.calls[0]![0]).toContain("corrupt");
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
  it("logs UnknownError when the thrown value is not an Error instance", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw "plain string error";
    });
    const chapter = { id: "abc", title: "Test", content: '{"valid":"json"}' };
    const result = parseChapterContent(chapter) as unknown as Record<string, unknown>;
    expect(result.content).toBeNull();
    expect(result.content_corrupt).toBe(true);
    expect(errorSpy.mock.calls[0]![0]).toContain("UnknownError");
    parseSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs error with chapter id when DB has corrupt JSON", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(errorSpy.mock.calls[0]![0]).toContain("test-123");
    errorSpy.mockRestore();
  });
});

