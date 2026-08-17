import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// F-19 (architecture report 2026-08-11). CLAUDE.md's "Target Project Structure"
// is the one artifact a newcomer — and every future /paad:agentic-architecture
// run — reads to learn where server code goes. It listed 7 of the 16 real
// module directories, omitting six whole feature domains (images, snapshots,
// outtakes, export, search, backup). The drift was invisible because nothing
// compared the prose to the tree.
//
// This is the forcing pause. Adding or removing a directory under
// packages/server/src now turns this red until the map is updated to match, in
// both directions — a listed directory that no longer exists misleads exactly
// as much as a real one that goes unmentioned.
//
// Scoped deliberately to the server module list: it has a single source of
// truth on disk. The volatile *counts* that also drifted (call sites, facade
// method count, EditorPage line count) were removed from the doc rather than
// guarded, because a number that is re-measured on every commit is a
// maintenance treadmill, not a fact worth pinning.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const doc = readFileSync(resolve(REPO_ROOT, "CLAUDE.md"), "utf-8");

/** Directory names listed under `server/` → `src/` in the structure fence. */
function documentedServerModules() {
  const [, after] = doc.split("## Target Project Structure\n");
  if (after === undefined) throw new Error('No "## Target Project Structure" heading in CLAUDE.md');
  const fence = after.match(/```\n([\s\S]*?)```/);
  if (!fence?.[1]) throw new Error("No fenced code block under Target Project Structure");

  // Entries nested under `    src/` carry six spaces of indent; `  server/`
  // and `  client/` carry two. Anchoring on the deeper indent keeps the
  // package-level lines out of the comparison.
  return fence[1]
    .split("\n")
    .map((line) => /^ {6}([\w-]+)\/(\s|$)/.exec(line))
    .flatMap((m) => (m?.[1] ? [m[1]] : []))
    .sort();
}

/** Real directories under packages/server/src, excluding the test dir. */
function actualServerModules() {
  return readdirSync(resolve(REPO_ROOT, "packages/server/src"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "__tests__")
    .map((e) => e.name)
    .sort();
}

describe("CLAUDE.md Target Project Structure", () => {
  it("lists every module directory under packages/server/src, and no others", () => {
    expect(documentedServerModules()).toEqual(actualServerModules());
  });

  it("reads real entries out of the fence (self-test — guards the parser)", () => {
    // If the parser silently matched nothing, the assertion above would pass
    // only when the server had no directories at all. Pin both sides non-empty.
    expect(actualServerModules().length).toBeGreaterThan(5);
    expect(documentedServerModules()).toContain("stores");
  });
});
