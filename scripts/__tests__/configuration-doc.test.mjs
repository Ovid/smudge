import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// F-33 (architecture report 2026-08-11). Smudge reads nine environment
// variables and had no inventory: no .env.example, no docs/configuration.md, no
// Configuration section anywhere. LOG_LEVEL — the one knob an operator
// diagnosing a live problem reaches for — appeared in no document at all, only
// in logger.ts and a code comment.
//
// The report flags this as a RE-confirmation (backlog id afcaee1c, "re-seen"):
// the gap closed once and drifted back. That is why it gets a forcing pause and
// not just a document.
//
// ── What this test does NOT prove ──────────────────────────────────────────
// The source of truth here is a REGEX OVER SOURCE, not a directory listing, so
// green means exactly one thing: "no literal `process.env.NAME` read in
// production source is missing a row." It cannot see:
//   • destructured reads      — const { LOG_LEVEL } = process.env
//   • computed reads          — process.env[someVariable]
//   • variables read only by deployment tooling outside this repo
// Do not read a green run as "every environment variable is documented."
// If you add an env var by one of those routes, add its row by hand.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DOC_PATH = "docs/configuration.md";

// Production source only. e2e/ and playwright.config.ts are test infrastructure:
// they set these variables rather than defining the app's contract.
const SCAN_ROOTS = [
  "packages/shared/src",
  "packages/server/src",
  "packages/server/scripts",
  "packages/client/src",
  "packages/client/vite.config.ts",
  "scripts",
];

const EXCLUDE = /__tests__|\.test\.|\/dist\//;

/** Every file under the scan roots that is a source file we should read. */
function sourceFiles() {
  const out = [];
  for (const root of SCAN_ROOTS) {
    const abs = resolve(REPO_ROOT, root);
    if (statSync(abs).isFile()) {
      out.push(abs);
      continue;
    }
    for (const rel of readdirSync(abs, { recursive: true })) {
      const full = join(abs, String(rel));
      if (EXCLUDE.test(full)) continue;
      if (!/\.(ts|tsx|mjs|js)$/.test(full)) continue;
      if (!statSync(full).isFile()) continue;
      out.push(full);
    }
  }
  return out;
}

/** Env var names read as a literal `process.env.NAME` in production source. */
function readEnvVars() {
  const found = new Set();
  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found].sort();
}

/** Names in the first column of any markdown table row in the doc. */
function documentedVars() {
  const doc = readFileSync(resolve(REPO_ROOT, DOC_PATH), "utf-8");
  return [...doc.matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/gm)].map((m) => m[1]).sort();
}

describe("docs/configuration.md", () => {
  it("has a row for every environment variable production source reads", () => {
    expect(documentedVars()).toEqual(readEnvVars());
  });

  it("scans real files and finds real reads (self-test — guards the scanner)", () => {
    // Without this, a scanner that matched nothing would make the assertion
    // above pass against an empty document.
    expect(sourceFiles().length).toBeGreaterThan(50);
    expect(readEnvVars()).toContain("LOG_LEVEL");
  });
});
