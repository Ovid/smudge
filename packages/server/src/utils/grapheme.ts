// Cache the segmenter at module scope. Project-wide replace-all can call
// truncateGraphemes many times per request (one auto-snapshot label per
// affected chapter), and each `new Intl.Segmenter(...)` allocates a fresh
// ICU handle. Reuse avoids measurable GC churn on busy paths.
//
// S5 (dedup review 2026-07-26): constructed unconditionally. The old
// `"Segmenter" in Intl` guard fell back to a code-unit slice — which
// reimplements the exact surrogate-splitting bug truncateGraphemes exists to
// prevent — and was unreachable: package.json pins `"node": "22.x"`, where
// Intl.Segmenter is always present, and wordcount.ts already calls
// `new Intl.Segmenter(...)` unguarded on every save path. Dead code that also
// dragged branch coverage.
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Truncate a string to at most `max` graphemes, appending no suffix.
 * Uses Intl.Segmenter so surrogate pairs and combining sequences are
 * never split mid-grapheme.
 */
export function truncateGraphemes(s: string, max: number): string {
  const out: string[] = [];
  for (const { segment } of GRAPHEME_SEGMENTER.segment(s)) {
    if (out.length >= max) break;
    out.push(segment);
  }
  return out.join("");
}
