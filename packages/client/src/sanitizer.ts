import DOMPurify from "dompurify";

// S11 (review 2026-04-24): defense-in-depth against a hostile
// backup/snapshot/server payload. TipTap's generateHTML always
// produces HTML bounded by editorExtensions (StarterKit + Heading
// levels 3-5 + Image, no Link yet), so any tag or attribute outside
// that set is either a future extension we'll add deliberately or an
// attacker-controlled payload routed through a compromised server
// or storage layer. Pinning an explicit allowlist keeps DOMPurify's
// default-permissive HTML profile from letting through anything new
// in future releases.
//
// Match tag-wise to:
//   paragraph, heading (h3/h4/h5), blockquote, bulletList, orderedList,
//   listItem, horizontalRule, hardBreak, bold, italic, strike, code,
//   codeBlock, image
// The image tag needs src / alt attributes; everything else needs no
// attributes beyond core id for anchors (not used today — excluded).
const ALLOWED_TAGS = [
  "p",
  "h3",
  "h4",
  "h5",
  "blockquote",
  "ul",
  "ol",
  "li",
  "hr",
  "br",
  "strong",
  "em",
  "s",
  "code",
  "pre",
  "img",
];

const ALLOWED_ATTR = ["src", "alt"];

// I14 (review 2026-04-25): pin every URI-bearing attribute to Smudge's
// own image endpoint. The regex below rejects data:, javascript:, vbscript:,
// http(s): externals, and anything else that isn't a relative
// `/api/images/...` path. We pass it as DOMPurify's ALLOWED_URI_REGEXP
// option for defense in depth.
const ALLOWED_URI_REGEXP = /^\/api\/images\//i;

// I14 (review 2026-04-25): DOMPurify 3.x ships a hardcoded DATA_URI_TAGS
// carve-out (img/audio/video/source/track) that lets `data:` URIs through
// `<img src>` even when ALLOWED_URI_REGEXP would otherwise reject them.
// This hook closes that carve-out by dropping any src/href/xlink:href whose
// value does not match ALLOWED_URI_REGEXP. Registered once at module load
// (ES module evaluation is cached, so the singleton picks it up exactly once).
DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "src" && data.attrName !== "href" && data.attrName !== "xlink:href") {
    return;
  }
  if (!ALLOWED_URI_REGEXP.test(data.attrValue)) {
    data.keepAttr = false;
  }
});

export function sanitizeEditorHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
  });
}
