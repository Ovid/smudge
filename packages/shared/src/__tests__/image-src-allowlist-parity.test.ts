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
//
// C1 (dedup review 2026-07-26): a THIRD encoding joined the corpus —
// IMAGE_SRC_REGEX (packages/server/src/images/images.paths.ts), the export
// resolver's scanner. It is not an allowlist (it answers "which id does this
// src reference?", scanning inside HTML rather than testing a bare src), but it
// runs IN SEQUENCE with ALLOWED_IMAGE_SRC on the export path: the allowlist
// keeps the <img>, the scanner then decides whether it resolves. A src the
// allowlist accepts and the scanner misses is silently DELETED from the export
// by the unresolved-image catch-all in image-resolver.ts. That is exactly what
// a `?query` suffix did before this column existed. Same corpus, same verdicts,
// wrapped in the `src="…"` the scanner expects.

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

/**
 * Rebuild the export resolver's scanner from its template plus the same
 * UUID_PATTERN. The `g` flag is dropped: `.test()` on a global regex is
 * stateful, and this test only asks "does it match at all?".
 */
function readResolverPattern(): RegExp {
  const src = readFileSync(SERVER_PATHS, "utf8");

  const tmpl = Array.from(
    src.matchAll(/^export const IMAGE_SRC_REGEX = new RegExp\(\s*`(.+)`,\s*"gi",?\s*\);$/gm),
  );
  expect(
    tmpl.length,
    "IMAGE_SRC_REGEX construction not found (or found more than once) in images.paths.ts — update this test.",
  ).toBe(1);

  const uuid = Array.from(src.matchAll(/^export const UUID_PATTERN = "(.+)";$/gm));
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

describe("the export resolver's scanner agrees with the allowlist that gates it", () => {
  const resolver = readResolverPattern();

  it.each(CORPUS)("%s → resolvable=%s", (_label, src, accepted) => {
    expect(
      resolver.test(`src="${src}"`),
      `export resolver disagreed on ${JSON.stringify(src)} — a src the allowlist keeps but the ` +
        `resolver cannot see is deleted outright from the exported manuscript`,
    ).toBe(accepted);
  });
});
