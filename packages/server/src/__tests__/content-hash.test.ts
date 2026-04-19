import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  canonicalContentHash,
  __resetWarnedFallbackDigestsForTests,
} from "../snapshots/content-hash";
import { logger } from "../logger";

describe("canonicalContentHash", () => {
  beforeEach(() => {
    // Each test inspects first-time warn behavior; reset the per-process
    // dedupe so the earlier test's warn'd digest doesn't silence this one.
    __resetWarnedFallbackDigestsForTests();
  });

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
    // Warn ONCE per unique corrupt content (keyed by raw-bytes digest);
    // repeat lookups against the same content downgrade to debug so one
    // corrupt row doesn't flood logs.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      // Same invalid string hashes the same; different strings differ.
      expect(canonicalContentHash("{not json")).toBe(canonicalContentHash("{not json"));
      expect(canonicalContentHash("{not json")).not.toBe(canonicalContentHash("other"));
      // First occurrence of each unique corrupt content warns; repeat
      // lookups of the same content go to debug.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ content_length: expect.any(Number), reason: "parse" }),
        expect.stringContaining("could not be canonicalized"),
      );
      expect(warnSpy).toHaveBeenCalledTimes(2); // one per unique string
      expect(debugSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "parse" }),
        expect.stringContaining("repeat raw-bytes fallback"),
      );
    } finally {
      warnSpy.mockRestore();
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

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      // Must not throw — it should fall back to raw-bytes hash.
      const hash = canonicalContentHash(json);
      expect(hash).toHaveLength(64);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "depth" }),
        expect.any(String),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
