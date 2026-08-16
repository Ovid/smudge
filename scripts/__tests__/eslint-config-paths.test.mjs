import { describe, it, expect } from "vitest";
import { isAbsolute } from "node:path";
import config from "../../eslint.config.js";

// S5 (review 2026-08-16). `import/no-extraneous-dependencies` resolves each
// `packageDir` entry with `path.resolve()` — i.e. against `process.cwd()`. With
// a multi-element array the plugin reads each manifest with its throw-at-read
// flag OFF, so a `packageDir` that points nowhere is skipped in silence: the
// rule then compares imports against an EMPTY dependency set and reports
// nothing. That is a false green, and it is indistinguishable from a clean run.
//
// Absolute paths are the whole guarantee. This asserts it structurally rather
// than by lint-run comparison, because the surrounding `files:` globs are
// themselves cwd-relative — a cwd-varying lint run goes quiet for that reason
// too, which would mask the very thing under test.
describe("eslint.config.js packageDir entries", () => {
  const entries = config
    .flatMap((block) => Object.entries(block?.rules ?? {}))
    .filter(([rule]) => rule === "import/no-extraneous-dependencies")
    .flatMap(([, value]) => (Array.isArray(value) ? value.slice(1) : []))
    .flatMap((options) => {
      const dir = options?.packageDir;
      return dir === undefined ? [] : Array.isArray(dir) ? dir : [dir];
    });

  it("finds the packageDir options it is meant to be guarding", () => {
    // Without this, a rename or restructure that drops every option would
    // leave the assertion below vacuously green.
    expect(entries.length).toBeGreaterThanOrEqual(4);
  });

  it("are all absolute, so the rule cannot silently no-op off-root", () => {
    expect(entries.filter((dir) => !isAbsolute(dir))).toEqual([]);
  });
});
