/**
 * Escape the five HTML metacharacters so user-supplied text (project/chapter
 * titles, author names, image captions) is safe to interpolate into the HTML
 * and EPUB export output.
 *
 * This lives in its own leaf module rather than in `export.renderers` because
 * it is a pure string utility with no dependency on the rendering pipeline.
 * Keeping it here lets `image-resolver` use it without importing back from
 * `export.renderers` (which imports `image-resolver`), breaking what would
 * otherwise be a bidirectional module cycle.
 *
 * `&` is replaced first so that the entities introduced by the subsequent
 * replacements (e.g. `&lt;`) are not themselves double-escaped.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
