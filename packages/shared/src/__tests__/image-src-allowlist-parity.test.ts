import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// S3 (dedup review 2026-07-26): the client's ALLOWED_URI_REGEXP
// (packages/client/src/sanitizer.ts) and the server's ALLOWED_IMAGE_SRC
// (packages/server/src/export/export.renderers.ts) encode ONE fail-closed rule
// — "is this src a relative /api/images/<uuid> reference?" — applied on two
// different rendering routes: DOMPurify on the live client, and the export
// renderers on the server. They were byte-identical with a ONE-WAY comment
// reference (export pointed at the client; the client pointed only at
// IMAGE_SRC_RE), so nothing tied them together in either direction.
//
// They deliberately are NOT unified into @smudge/shared: CLAUDE.md's accepted
// F-16 trade-off keeps the client and server image-URI rules separate, and the
// server's copy now splices in its own UUID_PATTERN. A textual/behavioral
// parity check is the next-best guarantee, following the
// DEFAULT_SERVER_PORT_VITE precedent in this directory. This test lives in
// `shared` because it is the only package that may read both of the others.
//
// If this fails, the two rules have diverged. Decide DELIBERATELY which one is
// right and update both — a widened client accepts srcs the export drops (a
// broken image in the downloaded file); a widened export embeds bytes the
// client refuses to render.

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SANITIZER = resolve(HERE, "../../../client/src/sanitizer.ts");
const SERVER_RENDERERS = resolve(HERE, "../../../server/src/export/export.renderers.ts");
const SERVER_PATHS = resolve(HERE, "../../../server/src/images/images.paths.ts");

/** Pull the client's inline regex literal out of its source. */
function readClientPattern(): RegExp {
  const src = readFileSync(CLIENT_SANITIZER, "utf8");
  const matches = Array.from(src.matchAll(/^const ALLOWED_URI_REGEXP =\s*\n?\s*\/(.+)\/i;$/gm));
  expect(
    matches.length,
    "ALLOWED_URI_REGEXP literal not found (or found more than once) in sanitizer.ts — was it renamed, or is it no longer a plain regex literal? Update this test.",
  ).toBe(1);
  return new RegExp(matches[0]![1]!, "i");
}

/** Rebuild the server's regex from its template plus the UUID_PATTERN it splices in. */
function readServerPattern(): RegExp {
  const renderers = readFileSync(SERVER_RENDERERS, "utf8");
  const uuidSrc = readFileSync(SERVER_PATHS, "utf8");

  const tmpl = Array.from(
    renderers.matchAll(/^export const ALLOWED_IMAGE_SRC = new RegExp\(`(.+)`, "i"\);$/gm),
  );
  expect(
    tmpl.length,
    "ALLOWED_IMAGE_SRC construction not found (or found more than once) in export.renderers.ts — update this test.",
  ).toBe(1);

  const uuid = Array.from(uuidSrc.matchAll(/^export const UUID_PATTERN = "(.+)";$/gm));
  expect(uuid.length, "UUID_PATTERN not found in images.paths.ts — update this test.").toBe(1);

  return new RegExp(tmpl[0]![1]!.replace("${UUID_PATTERN}", uuid[0]![1]!), "i");
}

const UUID = "11111111-2222-3333-4444-555555555555";

// Every case both rules must agree on. The rejections are the ones that matter:
// each is a real vector one side or the other has had to close.
const CORPUS: [label: string, src: string, accepted: boolean][] = [
  ["a bare relative reference", `/api/images/${UUID}`, true],
  ["an uppercase uuid", `/API/IMAGES/${UUID.toUpperCase()}`, true],
  ["a query suffix", `/api/images/${UUID}?v=2`, true],
  ["a fragment suffix", `/api/images/${UUID}#frag`, true],
  ["an external host", `https://evil.example/api/images/${UUID}`, false],
  ["a protocol-relative host", `//evil.example/api/images/${UUID}`, false],
  ["query-string smuggling", `https://evil.example/?ref=/api/images/${UUID}/x`, false],
  ["a javascript: scheme", `javascript:x/api/images/${UUID}`, false],
  ["a data: uri", "data:text/html;base64,PHNjcmlwdD4=", false],
  ["an extra path segment", `/api/images/${UUID}/../../etc/passwd`, false],
  ["a traversal in place of the uuid", "/api/images/../../etc/passwd", false],
  ["a prefix-only path", "/api/images/", false],
  ["a non-uuid id", "/api/images/not-a-uuid", false],
  ["a truncated uuid", `/api/images/${UUID.slice(0, -1)}`, false],
  ["a leading-whitespace bypass attempt", ` /api/images/${UUID}`, false],
  ["a newline bypass attempt", `/api/images/${UUID}\n`, false],
  ["the empty string", "", false],
];

describe("client and server image-src allowlists agree", () => {
  const client = readClientPattern();
  const server = readServerPattern();

  it.each(CORPUS)("%s → accepted=%s on both sides", (_label, src, accepted) => {
    expect(client.test(src), `client sanitizer disagreed on ${JSON.stringify(src)}`).toBe(accepted);
    expect(server.test(src), `server export disagreed on ${JSON.stringify(src)}`).toBe(accepted);
  });
});
