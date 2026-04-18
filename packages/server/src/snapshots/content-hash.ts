import { createHash } from "crypto";
import { MAX_TIPTAP_DEPTH } from "@smudge/shared";
import { logger } from "../logger";

class CanonicalizeDepthError extends Error {}

/**
 * Recursively sort object keys so that semantically equivalent TipTap
 * JSON documents produce the same canonical string regardless of key
 * ordering or whitespace in the original serialization.
 *
 * Throws CanonicalizeDepthError if the structure is deeper than
 * MAX_TIPTAP_DEPTH. Guards against stack-overflow when a legacy or
 * crafted snapshot contains pathologically deep (but syntactically
 * valid) JSON — the write paths already cap depth via TipTapDocSchema,
 * but this runs on stored rows whose depth was never verified.
 */
function canonicalize(value: unknown, depth: number = 0): unknown {
  if (depth > MAX_TIPTAP_DEPTH) throw new CanonicalizeDepthError();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v, depth + 1));
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => [k, canonicalize(v, depth + 1)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = v;
  return out;
}

/**
 * Hash a JSON content string canonically (stable key order) so dedup
 * survives re-serialization (editor round-trips, replace-in-doc, etc).
 * Falls back to hashing the raw string when parsing fails or the
 * content is pathologically deep.
 */
export function canonicalContentHash(content: string): string {
  let canonicalJson: string;
  try {
    canonicalJson = JSON.stringify(canonicalize(JSON.parse(content)));
  } catch (err) {
    // Falling back to raw bytes silently dedups corrupt-but-byte-identical
    // content across attempts. Demoted to debug: a single corrupt chapter
    // would otherwise log on every snapshot-create and every dedup check,
    // polluting test output and masking real warnings (CLAUDE.md zero-
    // warnings policy).
    logger.debug(
      { content_length: content.length, reason: err instanceof CanonicalizeDepthError ? "depth" : "parse" },
      "canonicalContentHash: content could not be canonicalized; hashing raw bytes",
    );
    canonicalJson = content;
  }
  return createHash("sha256").update(canonicalJson).digest("hex");
}
