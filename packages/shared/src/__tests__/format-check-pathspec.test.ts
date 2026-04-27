import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// C1 (review 2026-04-27, third pass): the format-check recipe ends
// with a `git diff --quiet --` pathspec that gates whether prettier
// drift fails `make all`. Git's default pathspec semantics treat `**`
// as `*` (a single segment) without `:(glob)` magic, so a pattern like
// `e2e/**/*.ts` matches **zero files** (`e2e/*.ts` lives at depth 1).
// Pre-fix, `make all` silently un-gated `e2e/` formatting drift —
// prettier would have rewritten the file (the prettier glob *is*
// shell-glob and *does* recurse), but the trailing git-diff guard saw
// no matches and exited 0.
//
// I4 (review 2026-04-27, third pass): root-level `tsconfig.base.json`
// and the new `tsconfig.tooling.json` were also outside the static-gate
// scope. A formatter drift in either is invisible to `make all`. The
// fix extends the pathspec; this test pins it.
//
// The test pins the load-bearing property: every file the branch put
// under prettier's reach via `npm run format` MUST also be enumerated
// by the Makefile's git-diff pathspec, otherwise drift is silently
// fixed on disk and never reported.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function extractFormatCheckPathspec(makefileText: string): string[] {
  const recipeMatch = makefileText.match(/^format-check:[\s\S]*?(?=^\S|\n\n[A-Za-z])/m);
  expect(recipeMatch, "format-check recipe block in Makefile").toBeTruthy();
  const gitDiffMatch = recipeMatch![0].match(/git diff --quiet -- ([^|\n]+?)(?:\s*\|\||\s*$)/m);
  expect(gitDiffMatch, "git diff --quiet pathspec line").toBeTruthy();
  const argsLine = gitDiffMatch![1].trim();
  const tokens = argsLine.match(/'[^']*'|"[^"]*"|\S+/g);
  expect(tokens, "tokenized pathspec args").toBeTruthy();
  return tokens!.map((t) => t.replace(/^['"]|['"]$/g, ""));
}

function lsFilesByPathspec(pathspec: string[]): string[] {
  const args = pathspec.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(" ");
  const out = execSync(`git ls-files -- ${args}`, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  });
  return out
    .trim()
    .split("\n")
    .filter((s) => s.length > 0);
}

describe("Makefile format-check pathspec coverage", () => {
  const makefileText = readFileSync(resolve(PROJECT_ROOT, "Makefile"), "utf8");

  // Files this branch put under prettier's `npm run format` reach.
  // Each one must be matched by at least one Makefile pathspec arg —
  // otherwise prettier rewrites the file and the trailing git-diff
  // guard exits 0 silently.
  const REQUIRED_FILES = [
    "e2e/dashboard.spec.ts",
    "e2e/editor-save.spec.ts",
    "e2e/snapshots.spec.ts",
    "playwright.config.ts",
    "vitest.config.ts",
    "tsconfig.base.json",
    "tsconfig.tooling.json",
  ];

  it("matches every file the branch added to prettier's reach", () => {
    const pathspec = extractFormatCheckPathspec(makefileText);
    const matched = new Set(lsFilesByPathspec(pathspec));
    for (const file of REQUIRED_FILES) {
      expect(
        matched.has(file),
        `format-check pathspec must match ${file} (current pathspec: ${pathspec.join(" ")})`,
      ).toBe(true);
    }
  });

  it("matches at least one file under e2e/ via the recursive glob", () => {
    // Sentinel: a pathspec like `e2e/**/*.ts` (no :(glob) magic) treats
    // `**` as `*` and matches zero files at depth 1. Verify the live
    // pathspec returns a non-empty set when filtered to `e2e/`.
    const pathspec = extractFormatCheckPathspec(makefileText);
    const matched = lsFilesByPathspec(pathspec).filter((f) => f.startsWith("e2e/"));
    expect(matched.length, `expected at least one e2e/* file in pathspec match`).toBeGreaterThan(0);
  });
});
