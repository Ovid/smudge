import DOMPurify from "dompurify";

// S2 (review 2026-04-25): scope our hook registration to a private
// DOMPurify instance rather than the package-level singleton. Without
// this, every other importer of `dompurify` (today none, but trivially
// possible in the future) — including bare `DOMPurify.sanitize` calls
// in tests, Vite HMR re-imports, and any code path that does not route
// through `sanitizeEditorHtml` — would inherit our `uponSanitizeAttribute`
// hook unintentionally. Calling `DOMPurify(window)` constructs a fresh
// instance bound to this realm; the global default singleton stays
// untouched.
const purifier = DOMPurify(window);

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

// S3 (review 2026-04-25): exported so a regression test can pin the exact
// shape. The URI-validation hook below only inspects src/href/xlink:href —
// adding any other URI-bearing attribute (srcset, longdesc) would let a
// hostile URI through without going through ALLOWED_URI_REGEXP.
// S3 (review 2026-04-25 round 3): typed as `readonly string[]` and frozen
// at runtime so an accidental mutation by another importer or a test
// cannot silently widen the allowlist. DOMPurify's ALLOWED_ATTR option is
// typed `string[]`, so the sanitize call below passes a fresh spread copy
// — both for type compatibility and as a belt-and-braces against any
// hypothetical mutation by the library itself.
export const ALLOWED_ATTR: readonly string[] = Object.freeze(["src", "alt"]);

// I14 (review 2026-04-25): pin every URI-bearing attribute to Smudge's
// own image endpoint. The regex below rejects data:, javascript:, vbscript:,
// http(s): externals, and anything else that isn't a relative
// `/api/images/<uuid>` path. We pass it as DOMPurify's ALLOWED_URI_REGEXP
// option for defense in depth.
//
// S1 (review 2026-04-25): intentionally narrower than the server's
// IMAGE_SRC_RE in `packages/server/src/images/images.references.ts`,
// which accepts `^(?:https?://[^/]+)?/api/images/<uuid>` so that pasted
// absolute URLs still increment the reference count. The sanitizer's
// threat model is XSS in the rendered DOM, not server-side reference
// counting — every writer Smudge ships today (`onInsertImage` in
// `ImageGallery.tsx`) emits the relative form, so accepting only the
// relative form here is correct and tight. If a future writer ever
// emits an absolute same-origin URL, the server will count the
// reference (block delete with IMAGE_IN_USE) while the sanitizer
// strips the src — the broken `<img>` is a deliberate fail-closed
// signal that lets us catch the divergence rather than silently
// accept new sources of `<img src>` in editor content.
//
// Round 3 (review 2026-04-25): require a full UUID path segment after
// `/api/images/` — a prefix-only check let `/api/images/javascript:`,
// `/api/images/../../etc/passwd`, and `/api/images/?x=javascript:` pass.
// `<img src>` cannot execute JS and `<a>` isn't in ALLOWED_TAGS today,
// so XSS is unreachable — but the gap is latent if Link is later added
// to editorExtensions. Mirror the UUID shape from the server's
// IMAGE_SRC_RE so client and server agree on what counts as an image
// URL. The trailing alternation allows the rendered server URL form
// (`/api/images/<uuid>`, with optional `?query` or `#fragment` or
// nothing) but rejects extra path segments.
const ALLOWED_URI_REGEXP =
  /^\/api\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[?#].*)?$/i;

// I14 (review 2026-04-25): DOMPurify 3.x ships a hardcoded DATA_URI_TAGS
// carve-out (img/audio/video/source/track) that lets `data:` URIs through
// `<img src>` even when ALLOWED_URI_REGEXP would otherwise reject them.
// This hook closes that carve-out by dropping any src/href/xlink:href whose
// value does not match ALLOWED_URI_REGEXP. Registered on the private
// instance (S2), not the package-level singleton.
purifier.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "src" && data.attrName !== "href" && data.attrName !== "xlink:href") {
    return;
  }
  if (!ALLOWED_URI_REGEXP.test(data.attrValue)) {
    data.keepAttr = false;
  }
});

export function sanitizeEditorHtml(html: string): string {
  return purifier.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    ALLOWED_URI_REGEXP,
  });
}
