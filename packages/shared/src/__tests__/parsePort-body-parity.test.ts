import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// I8 (review 2026-04-27): `vite.config.ts` carries an inline copy of
// `parsePort` because vite's CONFIG resolver loads under bare Node ESM
// and cannot follow `@smudge/shared`'s extensionless re-exports inside
// `src/index.ts`. The inline copy is documented as "byte-for-byte
// comparable" with the canonical, but the only enforcement is a comment
// — any change to the canonical (new IPv4-only flag, accepting "0" for
// ephemeral binding, broader rejection rules) silently diverges. With
// playwright.config.ts now imported parsePort from @smudge/shared, the
// inline copy is the sole outlier; pin its body byte-for-byte to the
// canonical so divergence is caught at unit-test time, not at the next
// person's `make e2e` (vite copy stale) or `make dev` (canonical
// stale).
//
// Strategy: extract the function body (everything between `): number {`
// and the matching `\n}` at column 0) from each file, normalize runs of
// whitespace to a single space, and compare. Whitespace normalization
// makes the test resilient to prettier reformatting one file but not
// the other; it does NOT mask operator/identifier changes.

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

// Anchor on the closing-brace at column 0 so the `}` inside template-
// literal interpolations like `${JSON.stringify(raw)}` doesn't match.
const PARSE_PORT_BODY_RE = /function parsePort\([^)]*\): number \{\n([\s\S]*?)\n\}/;

function extractBody(source: string, fileLabel: string): string {
  const match = source.match(PARSE_PORT_BODY_RE);
  expect(
    match,
    `parsePort function body not found in ${fileLabel} — was the signature rewritten? Update this test to match.`,
  ).not.toBeNull();
  return match![1]!;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("parsePort body parity", () => {
  it("vite.config.ts inline parsePort matches @smudge/shared/parsePort", () => {
    const sharedSource = readFileSync(
      resolve(PROJECT_ROOT, "packages/shared/src/parsePort.ts"),
      "utf8",
    );
    const viteConfigSource = readFileSync(
      resolve(PROJECT_ROOT, "packages/client/vite.config.ts"),
      "utf8",
    );
    const sharedBody = normalize(extractBody(sharedSource, "packages/shared/src/parsePort.ts"));
    const viteBody = normalize(extractBody(viteConfigSource, "packages/client/vite.config.ts"));
    expect(
      viteBody,
      "vite.config.ts inline parsePort body has drifted from @smudge/shared/parsePort. " +
        "Sync the function bodies (the canonical lives in packages/shared/src/parsePort.ts).",
    ).toBe(sharedBody);
  });
});
