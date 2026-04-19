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
/**
 * Keys that would mutate the scratch object's prototype chain when set
 * via bracket access. TipTapDocSchema uses .passthrough(), so content
 * read from the DB can legitimately carry any key — skip these so a
 * crafted `{"__proto__": {...}}` attrs value can't poison canonicalize.
 * Hashing proceeds with the key absent (dedup still works, the "poison"
 * attrs just doesn't contribute to the hash).
 */
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function canonicalize(value: unknown, depth: number = 0): unknown {
  if (depth > MAX_TIPTAP_DEPTH) throw new CanonicalizeDepthError();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v, depth + 1));
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k]) => !UNSAFE_KEYS.has(k))
    .map(([k, v]) => [k, canonicalize(v, depth + 1)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of entries) out[k] = v;
  return out;
}

/**
 * Per-process set of raw-bytes digests that have already produced a warn
 * for canonicalize fallback. Emitting a warn every snapshot-create for
 * the same corrupt chapter would flood logs and mask unrelated warnings,
 * so warn once per unique content (by byte-digest), debug for the rest.
 *
 * Bounded via FIFO eviction: an adversarial / long-running server that
 * sees a wide stream of distinct corrupt contents would otherwise grow
 * the set without bound. 256 entries is large enough that a handful of
 * real corrupt chapters still dedupe, small enough to cap memory.
 */
const WARNED_FALLBACK_LIMIT = 256;
const warnedFallbackDigests = new Set<string>();

function noteWarnedDigest(digest: string): void {
  // Set iteration order is insertion order; delete the oldest entry to
  // keep the cap. Re-insert if already present so recent digests stay
  // warm (LRU-ish — re-add bumps to the end).
  if (warnedFallbackDigests.has(digest)) {
    warnedFallbackDigests.delete(digest);
    warnedFallbackDigests.add(digest);
    return;
  }
  if (warnedFallbackDigests.size >= WARNED_FALLBACK_LIMIT) {
    const oldest = warnedFallbackDigests.values().next().value;
    if (oldest !== undefined) warnedFallbackDigests.delete(oldest);
  }
  warnedFallbackDigests.add(digest);
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
    // content across attempts. Warn ONCE per unique corrupt content (keyed
    // by raw-bytes digest) so operators see novel corruption but repeated
    // dedup lookups against the same row don't flood logs.
    canonicalJson = content;
    const rawDigest = createHash("sha256").update(content).digest("hex");
    const reason = err instanceof CanonicalizeDepthError ? "depth" : "parse";
    const alreadyWarned = warnedFallbackDigests.has(rawDigest);
    noteWarnedDigest(rawDigest);
    if (!alreadyWarned) {
      logger.warn(
        { content_length: content.length, reason, digest: rawDigest },
        "canonicalContentHash: content could not be canonicalized; hashing raw bytes",
      );
    } else {
      logger.debug(
        { content_length: content.length, reason, digest: rawDigest },
        "canonicalContentHash: repeat raw-bytes fallback",
      );
    }
    return rawDigest;
  }
  return createHash("sha256").update(canonicalJson).digest("hex");
}

/**
 * Test-only: reset the warned-digest dedupe so independent tests don't
 * suppress each other's assertions. Exported as a named function rather
 * than exposing the Set directly so callers can't accidentally add
 * entries.
 */
export function __resetWarnedFallbackDigestsForTests(): void {
  warnedFallbackDigests.clear();
}
