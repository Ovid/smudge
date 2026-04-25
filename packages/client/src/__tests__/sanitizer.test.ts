import { describe, it, expect } from "vitest";
import DOMPurify from "dompurify";
import { sanitizeEditorHtml, ALLOWED_ATTR } from "../sanitizer";

// I18 (review 2026-04-24): sanitizer is the app's defense-in-depth
// against hostile backup / snapshot / server payloads. Without
// regression tests, a future allowlist edit (adding <a> without href,
// dropping the img alt requirement, widening ALLOWED_ATTR) would go
// unnoticed because the file is small and skips the coverage floor.
// These tests pin the declared contract so the allowlist cannot drift
// silently.

describe("sanitizeEditorHtml", () => {
  it("strips <script> tags and their payload", () => {
    const input = `<p>safe</p><script>alert(1)</script>`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<p>safe</p>");
  });

  it("strips event-handler attributes (onerror, onclick, onload)", () => {
    const input = `<img src="x.png" onerror="alert(1)"><p onclick="x()">t</p>`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toContain("alert(1)");
  });

  it("strips javascript: URIs from img src", () => {
    const input = `<img src="javascript:alert(1)" alt="x">`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toMatch(/<img[^>]*\bsrc=/i);
    expect(out).not.toMatch(/javascript:/i);
  });

  it("strips disallowed tags (iframe, object, embed, form)", () => {
    const input = `<iframe src="evil"></iframe><object></object><embed src="e"><form></form>`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<object");
    expect(out).not.toContain("<embed");
    expect(out).not.toContain("<form");
  });

  it("strips style/link/meta tags (CSS exfil / redirects)", () => {
    const input = `<style>body{}</style><link rel="stylesheet" href="evil.css"><meta http-equiv="refresh" content="0;url=evil">`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toContain("<style");
    expect(out).not.toContain("<link");
    expect(out).not.toContain("<meta");
  });

  it("preserves allowed formatting tags and structure", () => {
    const input =
      `<p>plain</p><h3>h3</h3><h4>h4</h4><h5>h5</h5>` +
      `<blockquote>q</blockquote><ul><li>x</li></ul><ol><li>y</li></ol>` +
      `<hr><br><strong>b</strong><em>i</em><s>s</s><code>c</code><pre>pre</pre>`;
    const out = sanitizeEditorHtml(input);
    for (const tag of [
      "<p>",
      "<h3>",
      "<h4>",
      "<h5>",
      "<blockquote>",
      "<ul>",
      "<ol>",
      "<li>",
      "<hr",
      "<br",
      "<strong>",
      "<em>",
      "<s>",
      "<code>",
      "<pre>",
    ]) {
      expect(out).toContain(tag);
    }
  });

  it("preserves img src + alt (used by the image extension)", () => {
    const input = `<img src="/api/images/abc" alt="a cat">`;
    const out = sanitizeEditorHtml(input);
    expect(out).toContain(`src="/api/images/abc"`);
    expect(out).toContain(`alt="a cat"`);
  });

  it("drops disallowed attributes (class, style, id, title)", () => {
    const input = `<p class="evil" style="color:red" id="x" title="t">t</p>`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toMatch(/\bclass=/);
    expect(out).not.toMatch(/\bstyle=/);
    expect(out).not.toMatch(/\bid=/);
    expect(out).not.toMatch(/\btitle=/);
  });

  it("strips <a> entirely (Link is not in editorExtensions today)", () => {
    const input = `<p>before</p><a href="https://evil.example">link</a><p>after</p>`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toContain("<a");
    expect(out).not.toContain("evil.example");
    // Inner text is preserved (DOMPurify's default behavior for removed tags).
    expect(out).toContain("link");
  });

  it("handles empty string without throwing", () => {
    expect(sanitizeEditorHtml("")).toBe("");
  });

  // S5 (review 2026-04-25): the regex `not.toMatch(/<img[^>]*\bsrc=/i)` is
  // strictly stronger than substring assertions because it also catches
  // partially-stripped attributes (e.g. an empty `src=""` survivor or a
  // residual `src` with a different hostile value). Mirrors the e2e
  // assertion in sanitizer-snapshot-blob.spec.ts.
  it("rejects data: URIs in img src (XSS vector — I14)", () => {
    const malicious = `<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">`;
    const out = sanitizeEditorHtml(malicious);
    expect(out).not.toMatch(/<img[^>]*\bsrc=/i);
    expect(out).not.toContain("data:");
  });

  it("rejects http(s) URIs not under /api/images/ in img src (I14)", () => {
    const input = `<img src="http://example.com/x.png" alt="x">`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toMatch(/<img[^>]*\bsrc=/i);
    expect(out).not.toContain("example.com");
  });

  // I2 (review 2026-04-25): pin the implicit-allowlist contract for the
  // mXSS-relevant <svg>/<math> namespaces and the media tags whose src/srcset
  // would otherwise hit the new URI hook. These tags are not in ALLOWED_TAGS,
  // so DOMPurify strips them today — but a future config tweak (e.g. switching
  // to FORBID_TAGS, widening to include media) would silently lift the
  // restriction with no failing test. These cases lock down the contract.
  it("strips <svg> tags (mXSS namespace)", () => {
    const input = `<p>before</p><svg><script>alert(1)</script></svg><p>after</p>`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("alert(1)");
  });

  it("strips <math> tags (mXSS namespace)", () => {
    const input = `<p>before</p><math><mtext></mtext></math><p>after</p>`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toContain("<math");
    expect(out).not.toContain("<mtext");
  });

  it("strips media tags <audio>/<video>/<source>/<track>", () => {
    const input =
      `<audio src="/api/images/a"></audio>` +
      `<video src="/api/images/v"><source src="/api/images/s"><track src="/api/images/t"></video>`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toContain("<audio");
    expect(out).not.toContain("<video");
    expect(out).not.toContain("<source");
    expect(out).not.toContain("<track");
  });

  it("strips <base> (would otherwise rebase relative URIs)", () => {
    const input = `<base href="https://evil.example/"><p>after</p>`;
    const out = sanitizeEditorHtml(input);
    expect(out).not.toContain("<base");
    expect(out).not.toContain("evil.example");
  });

  // S3 (review 2026-04-25): pin ALLOWED_ATTR's exact shape so a future
  // widening (e.g. adding `srcset`, `href`, `title`) is caught at test
  // time. The URI-validation hook in sanitizer.ts only inspects src,
  // href, and xlink:href — adding any other URI-bearing attribute to
  // ALLOWED_ATTR would let a hostile URI through without going through
  // ALLOWED_URI_REGEXP. This test fails if ALLOWED_ATTR drifts from the
  // declared contract; intentional widening must update both.
  it("pins ALLOWED_ATTR to exactly ['src', 'alt'] (S3)", () => {
    expect(ALLOWED_ATTR).toEqual(["src", "alt"]);
  });

  // S2 (review 2026-04-25): the URI-validation hook must live on a private
  // DOMPurify instance, not on the package-level singleton. Importing
  // DOMPurify directly elsewhere (or in a test, or under Vite HMR) must
  // see the unmodified default behavior — including DOMPurify 3.x's
  // DATA_URI_TAGS carve-out that lets data: URIs through <img src>. If
  // sanitizer.ts mutates the singleton via addHook, this test fails
  // because the directly-imported DOMPurify also strips data: URIs.
  it("does not pollute the global DOMPurify singleton (S2)", () => {
    const malicious = `<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">`;
    const out = DOMPurify.sanitize(malicious);
    expect(out).toContain("data:image/svg+xml");
  });
});
