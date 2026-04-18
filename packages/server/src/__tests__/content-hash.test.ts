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
    // Debug-level (not warn) — a single corrupt chapter would otherwise log
    // on every snapshot create. Still assert it is emitted so future
    // refactors don't drop operator-visible observability entirely.
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      // Same invalid string hashes the same; different strings differ.
      expect(canonicalContentHash("{not json")).toBe(canonicalContentHash("{not json"));
      expect(canonicalContentHash("{not json")).not.toBe(canonicalContentHash("other"));
      expect(debugSpy).toHaveBeenCalledWith(
        expect.objectContaining({ content_length: expect.any(Number), reason: "parse" }),
        expect.stringContaining("could not be canonicalized"),
      );
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("falls back to raw bytes when JSON nesting exceeds MAX_TIPTAP_DEPTH (CP2)", () => {
    // Pathologically deep (but syntactically valid) JSON must not
    // stack-overflow the process during dedup. Build a structure with
    // depth well beyond MAX_TIPTAP_DEPTH (64) so the guard fires.
    let deep: unknown = 1;
    for (let i = 0; i < 200; i++) deep = [deep];
    const json = JSON.stringify(deep);

    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      // Must not throw — it should fall back to raw-bytes hash.
      const hash = canonicalContentHash(json);
      expect(hash).toHaveLength(64);
      expect(debugSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "depth" }),
        expect.any(String),
      );
    } finally {
      debugSpy.mockRestore();
    }
  });
});
