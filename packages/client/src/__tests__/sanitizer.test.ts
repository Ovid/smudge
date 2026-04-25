import { describe, it, expect } from "vitest";
import { sanitizeEditorHtml } from "../sanitizer";

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

  it("rejects data: URIs in img src (XSS vector — I14)", () => {
    const malicious = `<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">`;
    const out = sanitizeEditorHtml(malicious);
    expect(out).not.toContain("data:");
  });
});
