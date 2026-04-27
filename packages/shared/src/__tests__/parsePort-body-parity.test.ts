import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// I8 (review 2026-04-27, second pass): `vite.config.ts` carries an
// inline copy of `parsePort` because vite's CONFIG resolver loads under
// bare Node ESM and cannot follow `@smudge/shared`'s extensionless
// re-exports inside `src/index.ts`. The inline copy is documented as
// "byte-for-byte comparable" with the canonical, but the only
// enforcement is a comment — any change to the canonical (new IPv4-only
// flag, accepting "0" for ephemeral binding, broader rejection rules)
// silently diverges. Pin the body byte-for-byte to the canonical so
// drift is caught at unit-test time, not at the next `make e2e` (vite
// copy stale) or `make dev` (canonical stale).
//
// I3 (review 2026-04-27, third pass): the prior version of this test
// had three weaknesses that defeated different drift scenarios it
// claimed to catch.
//
//   1. `.match()` (non-global) returns the FIRST hit. A future change
//      that introduces a SECOND `function parsePort(...)` body in
//      either file (overload, debug stub, fixture string) leaves the
//      duplicate uncompared and silently drifting. Use `matchAll` plus
//      a `length === 1` assertion (matching the e2e-data-dir-parity
//      `findExactlyOne` pattern).
//
//   2. The pre-fix regex was `/function parsePort\(...\): number \{\n
//      ([\s\S]*?)\n\}/` with no `m` flag. The leading comment claimed
//      "anchor on the closing-brace at column 0" but the regex did NOT
//      enforce that — `\n}` matched ANY indentation. The `}` inside a
//      template-literal interpolation (`${JSON.stringify(raw)}`)
//      happened not to match only because it is preceded by non-newline
//      characters, not because of column anchoring. Switch to `m` flag
//      and `\n^\}` so the comment's claim becomes the regex's
//      enforcement.
//
//   3. The non-greedy `[\s\S]*?` stops at the FIRST matching boundary.
//      A future maintainer who adds an inner block whose `}` lands at
//      column 0 (legal but unusual) would silently truncate the
//      compared body — both files could drift identically in the
//      truncated tail and still match. Today's parsePort body has no
//      column-0 `}` inside the function (every inner brace is
//      indented), so column-0 anchoring closes the gap; if the body
//      ever needs a column-0 `}` for stylistic reasons, swap to a
//      sentinel marker (`// END parsePort`) keyed on a literal trailer
//      both files must emit.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

// `m` flag: `^` and `$` match line starts/ends, so `\n^\}` enforces
// that the closing brace is at column 0. `g` flag: matchAll returns
// every occurrence; the test asserts `length === 1`.
const PARSE_PORT_BODY_RE = /^(?:export )?function parsePort\([^)]*\): number \{\n([\s\S]*?)\n^\}/gm;

function findParsePortBodies(source: string): string[] {
  return Array.from(source.matchAll(PARSE_PORT_BODY_RE)).map((m) => m[1]!);
}

function extractBody(source: string, fileLabel: string): string {
  const bodies = findParsePortBodies(source);
  expect(
    bodies.length,
    bodies.length === 0
      ? `parsePort function body not found in ${fileLabel} — was the signature rewritten? Update this test to match.`
      : `parsePort function body found ${bodies.length} times in ${fileLabel} — expected exactly one. Did a commented-out historical example or a debug stub sneak in?`,
  ).toBe(1);
  return bodies[0]!;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("parsePort body parity", () => {
  const sharedSource = readFileSync(
    resolve(PROJECT_ROOT, "packages/shared/src/parsePort.ts"),
    "utf8",
  );
  const viteConfigSource = readFileSync(
    resolve(PROJECT_ROOT, "packages/client/vite.config.ts"),
    "utf8",
  );

  it("vite.config.ts inline parsePort matches @smudge/shared/parsePort", () => {
    const sharedBody = normalize(extractBody(sharedSource, "packages/shared/src/parsePort.ts"));
    const viteBody = normalize(extractBody(viteConfigSource, "packages/client/vite.config.ts"));
    expect(
      viteBody,
      "vite.config.ts inline parsePort body has drifted from @smudge/shared/parsePort. " +
        "Sync the function bodies (the canonical lives in packages/shared/src/parsePort.ts).",
    ).toBe(sharedBody);
  });

  it("finds exactly one parsePort body per source file", () => {
    expect(findParsePortBodies(sharedSource)).toHaveLength(1);
    expect(findParsePortBodies(viteConfigSource)).toHaveLength(1);
  });

  it("matchAll detects duplicate bodies in the same file (drift sentinel for I3.1)", () => {
    // Synthesize a "duplicate body" scenario: a future change that
    // appends an overload, a debug stub, or a stale historical example
    // to either file. The sentinel verifies the regex+matchAll
    // combination would CATCH such a duplicate (the prior `.match()`
    // returned only the first hit and the second silently drifted).
    const doubled = sharedSource + "\n\n" + sharedSource;
    expect(findParsePortBodies(doubled)).toHaveLength(2);
  });
});
