// Cache the segmenter at module scope. Project-wide replace-all can call
// truncateGraphemes many times per request (one auto-snapshot label per
// affected chapter), and each `new Intl.Segmenter(...)` allocates a fresh
// ICU handle. Reuse avoids measurable GC churn on busy paths.
const GRAPHEME_SEGMENTER: Intl.Segmenter | null =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/**
 * Truncate a string to at most `max` graphemes, appending no suffix.
 * Uses Intl.Segmenter when available so surrogate pairs and combining
 * sequences are never split mid-grapheme. Falls back to code-unit slice
 * on environments without Segmenter (older Node builds).
 */
export function truncateGraphemes(s: string, max: number): string {
  if (!GRAPHEME_SEGMENTER) return s.length > max ? s.slice(0, max) : s;
  const out: string[] = [];
  for (const { segment } of GRAPHEME_SEGMENTER.segment(s)) {
    if (out.length >= max) break;
    out.push(segment);
  }
  return out.join("");
}
