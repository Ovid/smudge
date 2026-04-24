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

export function sanitizeEditorHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
