import { describe, it, expect, vi } from "vitest";
import { canonicalContentHash } from "../snapshots/content-hash";
import { logger } from "../logger";

describe("canonicalContentHash", () => {
  it("produces the same hash regardless of key order", () => {
    const a = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
    const b = JSON.stringify({ content: [{ type: "paragraph" }], type: "doc" });
    expect(canonicalContentHash(a)).toBe(canonicalContentHash(b));
  });

  it("produces the same hash regardless of whitespace", () => {
    const a = `{"type":"doc","content":[]}`;
    const b = `{\n  "type": "doc",\n  "content": []\n}`;
    expect(canonicalContentHash(a)).toBe(canonicalContentHash(b));
  });

  it("differs when content differs", () => {
    const a = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
    const b = JSON.stringify({ type: "doc", content: [{ type: "heading" }] });
    expect(canonicalContentHash(a)).not.toBe(canonicalContentHash(b));
  });

  it("falls back to hashing raw string when input is not JSON", () => {
    // Suppress and assert the corrupt-content warning to keep test output clean.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      // Same invalid string hashes the same; different strings differ.
      expect(canonicalContentHash("{not json")).toBe(canonicalContentHash("{not json"));
      expect(canonicalContentHash("{not json")).not.toBe(canonicalContentHash("other"));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ content_length: expect.any(Number) }),
        expect.stringContaining("not valid JSON"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
