/**
 * Truncate a string to at most `max` graphemes, appending no suffix.
 * Uses Intl.Segmenter when available so surrogate pairs and combining
 * sequences are never split mid-grapheme. Falls back to code-unit slice
 * on environments without Segmenter (older Node builds).
 */
export function truncateGraphemes(s: string, max: number): string {
  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  if (!segmenter) return s.length > max ? s.slice(0, max) : s;
  const out: string[] = [];
  for (const { segment } of segmenter.segment(s)) {
    if (out.length >= max) break;
    out.push(segment);
  }
  return out.join("");
}
