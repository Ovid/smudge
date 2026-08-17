import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// I3 (review 2026-08-16). CLAUDE.md §Dependency Licenses mandates a row per
// dependency, and the doc's own preamble claims it "catalogs every license in
// the project". Nothing enforced it: a branch moved the `@tiptap/*` rows out of
// the server and client tables without adding them to the shared table, and
// four SHIPPING production dependencies silently lost their only audit row.
//
// This is the forcing pause. Adding, moving, or removing a production
// dependency now turns this red until the doc is updated to match, in both
// directions — a stale row for a dependency that has left the tree is just as
// misleading as a missing one.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKSPACES = ["shared", "server", "client"];

const doc = readFileSync(resolve(REPO_ROOT, "docs/dependency-licenses.md"), "utf-8");

/**
 * Package names in the first column of the `### packages/<workspace>` table.
 * The section ends at the next heading of any level.
 * @param {string} workspace
 */
function documentedPackages(workspace) {
  const [, after] = doc.split(`### packages/${workspace}\n`);
  if (after === undefined) throw new Error(`No "### packages/${workspace}" section in the doc`);
  const [section = ""] = after.split(/^#/m);
  return (
    section
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .map((line) => line.split("|")[1]?.trim() ?? "")
      // Drop the header row and the `| --- |` separator.
      .filter((name) => name !== "" && name !== "Package" && !/^-+$/.test(name))
  );
}

/** @param {string} workspace */
function declaredDependencies(workspace) {
  const manifest = JSON.parse(
    readFileSync(resolve(REPO_ROOT, `packages/${workspace}/package.json`), "utf-8"),
  );
  // Workspace-internal links (`@smudge/shared`) are this repo's own code, not a
  // third-party license obligation.
  return Object.keys(manifest.dependencies ?? {}).filter((n) => !n.startsWith("@smudge/"));
}

describe("docs/dependency-licenses.md covers every production dependency", () => {
  for (const workspace of WORKSPACES) {
    it(`packages/${workspace}`, () => {
      expect(documentedPackages(workspace).sort()).toEqual(declaredDependencies(workspace).sort());
    });
  }
});
