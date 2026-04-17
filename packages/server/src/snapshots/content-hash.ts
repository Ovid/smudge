import { createHash } from "crypto";
import { logger } from "../logger";

/**
 * Recursively sort object keys so that semantically equivalent TipTap
 * JSON documents produce the same canonical string regardless of key
 * ordering or whitespace in the original serialization.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => [k, canonicalize(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = v;
  return out;
}

/**
 * Hash a JSON content string canonically (stable key order) so dedup
 * survives re-serialization (editor round-trips, replace-in-doc, etc).
 * Falls back to hashing the raw string when parsing fails.
 */
export function canonicalContentHash(content: string): string {
  let canonicalJson: string;
  try {
    canonicalJson = JSON.stringify(canonicalize(JSON.parse(content)));
  } catch {
    // Falling back to raw bytes silently dedups corrupt-but-byte-identical
    // content across attempts. Demoted to debug: a single corrupt chapter
    // would otherwise log on every snapshot-create and every dedup check,
    // polluting test output and masking real warnings (CLAUDE.md zero-
    // warnings policy).
    logger.debug(
      { content_length: content.length },
      "canonicalContentHash: content is not valid JSON; hashing raw bytes",
    );
    canonicalJson = content;
  }
  return createHash("sha256").update(canonicalJson).digest("hex");
}
