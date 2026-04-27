import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// C1 + I4 + I1 + S3 (review 2026-04-27, third pass): the format-check
// gate had two compounding bugs.
//
// C1: a git-pathspec sanity check at the end of the Makefile recipe used
// `e2e/**/*.ts` without `:(glob)` magic, so it matched zero files at
// depth 1 and silently un-gated `e2e/` formatting drift.
//
// I1: the recipe ran `npm run format` (prettier --write) instead of
// `npm run format:check`, silently mutating the user's tree on every
// `make all`.
//
// I4: root-level `tsconfig.base.json` and `tsconfig.tooling.json` fell
// outside `packages/**/*.json` and were invisible to the gate.
//
// S3: `make all` invoked `lint` (autofix) before `format-check`. With
// I1 fixed, the autofix can produce formatter-irrelevant changes that
// the trailing git-diff still catches with a misleading message.
//
// The fix collapses these into one shape:
//   - format-check is `npm run format:check` (prettier --check, read-only).
//     Drop the trailing git-diff guard — its message was misleading and
//     `prettier --check` is the actual format gate.
//   - package.json `format:check` glob covers every file the branch put
//     under prettier's reach (e2e/, playwright/vitest configs, root
//     tsconfig*.json).
//   - A `lint-check` Makefile target runs `eslint` without `--fix`, and
//     `make all` depends on it (not on the autofix `lint` target). CI
//     gates must not mutate the tree.
//
// These tests pin all four properties so a future "fix" reverting any
// one of them re-introduces the regression.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("format:check glob coverage (package.json)", () => {
  const pkg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("covers every file the branch put under prettier's reach", () => {
    const formatCheck = pkg.scripts["format:check"];
    expect(formatCheck, "package.json must define format:check").toBeTruthy();
    if (!formatCheck) return;

    // Each glob / literal path the branch added must appear in the
    // format:check command. Substring match is fine: prettier
    // tokenizes the args itself; we just need each pattern present.
    const REQUIRED_PATTERNS = [
      "e2e/**/*.ts", // C1: e2e specs
      "tsconfig*.json", // I4: root tsconfig.base.json + tsconfig.tooling.json
      "playwright.config.ts",
      "vitest.config.ts",
      "packages/**/*.{ts,tsx,json,css}",
    ];

    for (const pat of REQUIRED_PATTERNS) {
      expect(
        formatCheck.includes(pat),
        `format:check must include pattern ${pat} (current: ${formatCheck})`,
      ).toBe(true);
    }
  });

  it("format and format:check use the same glob set", () => {
    const format = pkg.scripts["format"];
    const formatCheck = pkg.scripts["format:check"];
    expect(format, "package.json must define format").toBeTruthy();
    expect(formatCheck, "package.json must define format:check").toBeTruthy();
    if (!format || !formatCheck) return;

    // Strip the action verb (--write / --check) and compare the rest.
    // If they diverge, prettier --check could miss drift that
    // prettier --write would have rewritten on `npm run format`.
    const formatArgs = format.replace(/^prettier --write\s+/, "").trim();
    const checkArgs = formatCheck.replace(/^prettier --check\s+/, "").trim();
    expect(formatArgs).toBe(checkArgs);
  });
});

describe("typecheck script covers tooling tsconfig (S12)", () => {
  // S12 (review 2026-04-27, third pass): the typecheck script chains
  // two tsc invocations:
  //   tsc -b packages/shared packages/server packages/client
  //   tsc --noEmit -p tsconfig.tooling.json
  //
  // The second covers playwright.config.ts, vitest.config.ts, and
  // anything else listed in tsconfig.tooling.json's `include`. If a
  // future refactor removes the second invocation, the tooling
  // typecheck silently disappears — the lint and format gates still
  // fire on those files, but typecheck does not. Pin both so a
  // half-rewrite is caught.
  const pkg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("invokes tsc -b for the workspace projects", () => {
    const typecheck = pkg.scripts["typecheck"];
    expect(typecheck, "package.json must define typecheck").toBeTruthy();
    if (!typecheck) return;
    expect(typecheck).toMatch(/\btsc\s+-b\b/);
  });

  it("invokes tsc --noEmit -p tsconfig.tooling.json for root-level configs", () => {
    const typecheck = pkg.scripts["typecheck"];
    expect(typecheck, "package.json must define typecheck").toBeTruthy();
    if (!typecheck) return;
    expect(typecheck).toMatch(/\btsc\s+--noEmit\s+-p\s+tsconfig\.tooling\.json\b/);
  });
});

describe("Makefile CI gate semantics (no autofix in `make all`)", () => {
  const makefileText = readFileSync(resolve(PROJECT_ROOT, "Makefile"), "utf8");

  it("format-check recipe runs prettier --check, not --write", () => {
    // I1: pre-fix, format-check ran `npm run format` (prettier --write),
    // silently mutating the user's tree on every `make all`. Switch to
    // `format:check` (read-only). Pin via textual property so a future
    // "fix" reverting to `format` re-introduces the regression.
    const recipeMatch = makefileText.match(/^format-check:[^\n]*\n(?:[\t ][^\n]*\n)+/m);
    expect(recipeMatch, "format-check recipe block").toBeTruthy();
    expect(recipeMatch![0]).toMatch(/\bnpm run format:check\b/);
    expect(
      recipeMatch![0],
      "format-check must NOT invoke `npm run format` (the writing variant)",
    ).not.toMatch(/^\s*(?:@\s*)?npm run format\s*$/m);
  });

  it("`make all` invokes lint-check (no autofix), not lint --fix", () => {
    // S3: `lint` runs `eslint --fix` (autofix). When invoked from
    // `make all` (the CI gate), a tree-mutating step in CI is wrong on
    // principle and produces confusing errors when format-check then
    // sees the mutation. Route `make all` through a no-autofix sibling.
    const allMatch = makefileText.match(/^all:[^\n]*$/m);
    expect(allMatch, "all: target line").toBeTruthy();
    const deps = allMatch![0].replace(/^all:/, "").replace(/##.*/, "").trim().split(/\s+/);
    expect(deps, "make all must depend on lint-check, not lint").toContain("lint-check");
    expect(deps, "make all must NOT depend on the autofix `lint` target").not.toContain("lint");
  });

  it("defines a lint-check target that runs eslint without --fix", () => {
    expect(makefileText).toMatch(/^lint-check:/m);
    const recipeMatch = makefileText.match(/^lint-check:[^\n]*\n(?:[\t ][^\n]*\n)+/m);
    expect(recipeMatch, "lint-check recipe block").toBeTruthy();
    expect(recipeMatch![0]).toMatch(/\bnpm run lint:check\b/);
  });
});
