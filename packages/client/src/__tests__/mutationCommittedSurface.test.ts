import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { collectTsSources, stripCommentsFromTsSource } from "./tsSourceScan";

// ===========================================================================
// F-07 forcing-pause: every useEditorMutation.run() caller owns the
// committed-but-unreloaded transition.
// ===========================================================================
//
// useEditorMutation.run() is the seam every editor-mutating flow routes
// through. On ONE path it deliberately dispatches no terminal machine event:
// when the server mutation committed but the confirming reload failed, it
// returns { ok: false, stage: "committed_but_unreloaded" } and leaves the
// machine at editable:false with NO lock. See the `if (reloadFailed)` no-op in
// useEditorMutation.ts's finally, and CLAUDE.md §Editor operational state.
//
// The caller must complete that transition — raise COMMITTED_UNRELOADED (lock
// banner + read-only, set together) or, when the active chapter has drifted
// away from the mutation's target, re-assert editable and surface a
// dismissible chapter-attributed notice instead. A caller that returns without
// doing either strands the writer in a read-only editor with nothing on screen
// explaining why, recoverable only by refreshing.
//
// Nothing in the type system enforces this: MutationResult is a plain value a
// caller may ignore. This test is the mechanical substitute. It pairs each
// mutation.run() call with a committed_but_unreloaded branch in the same file
// and goes red when a new caller lands without one.
//
//   *** If this test fails because you added a mutation.run() caller: STOP and
//   *** handle stage === "committed_but_unreloaded" before updating the list
//   *** below. Both existing callers show the two-case shape — lock when the
//   *** user is still on the chapter the mutation targeted, re-assert editable
//   *** plus a dismissible notice when they have drifted away. Skipping the
//   *** lock WITHOUT re-asserting is the failure this guards against.
//
// What it does NOT do: verify the handling is CORRECT. The OOSI1 restore bug
// (useFindReplaceController.ts, the `reloadFailed && stale` branch) was a
// caller that handled the stage but completed only one of its two sub-cases —
// this test would have been green throughout. Correctness lives in the
// behavioral tests in useFindReplaceController.test.tsx and
// useSnapshotController.test.tsx. This converts "a reviewer might notice a
// third caller" into "CI blocks until the author acknowledges it", exactly as
// editorEntryPointSurface.test.ts does for entry points under F-1.
//
// The pairing is per-FILE, not per-call, because a file's callers may share one
// handler. If a future refactor centralises the handling so the counts stop
// matching, this fails LOUDLY (a false RED demanding a decision) rather than
// passing silently — the safe failure direction.

const clientSrc = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// `mutation.run<T>(...)` or `mutation.run(...)`. Case-sensitive, so the
// `useEditorMutation.run()` spelling used in prose does not match.
const RUN_RE = /\bmutation\.run\s*[<(]/;
const COMMITTED_RE = /stage === "committed_but_unreloaded"/;

/**
 * Counts occurrences of `re` in executable code only.
 *
 * I2 (review 2026-08-19): this used to keep whole lines that did not *start*
 * with a comment token, then test the pattern against the entire line —
 * so a trailing `// stage === "committed_but_unreloaded"` counted as a
 * handler branch and a block-comment interior line not beginning with `*`
 * counted as code. A prose mention could stand in for a deleted handler.
 * Reuse the sibling drift detector's stripper instead: it removes comments
 * wherever they occur, not only at line start.
 */
export function countCodeMatches(source: string, re: RegExp): number {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return stripCommentsFromTsSource(source).match(global)?.length ?? 0;
}

// --- Committed caller surface. Update ONLY after reading the header. --------

const COMMITTED_CALLERS: Record<string, number> = {
  "hooks/useFindReplaceController.ts": 2,
  "hooks/useSnapshotController.ts": 1,
};

function discoverCallers(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of collectTsSources(clientSrc)) {
    const count = countCodeMatches(readFileSync(file, "utf8"), RUN_RE);
    if (count > 0) found[file.slice(clientSrc.length + 1)] = count;
  }
  return found;
}

describe("useEditorMutation caller surface (F-07 forcing pause)", () => {
  it("has exactly the committed set of mutation.run() callers", () => {
    expect(discoverCallers()).toEqual(COMMITTED_CALLERS);
  });

  it.each(Object.keys(COMMITTED_CALLERS))(
    "%s handles committed_but_unreloaded for every run() it makes",
    (relPath) => {
      const source = readFileSync(resolve(clientSrc, relPath), "utf8");
      expect(countCodeMatches(source, COMMITTED_RE)).toBe(COMMITTED_CALLERS[relPath]);
    },
  );
});

describe("countCodeMatches (drift-detector self-tests)", () => {
  it("counts real calls and ignores the same text in comments", () => {
    const fixture = [
      "  // await mutation.run(...) is the seam every caller routes through",
      "  /* mutation.run( in a block comment */",
      "  /**",
      "   * mutation.run( in a jsdoc continuation",
      "   */",
      "  const a = await mutation.run<Data>(async () => {});",
      "  const b = await mutation.run(async () => {});",
    ].join("\n");
    expect(countCodeMatches(fixture, RUN_RE)).toBe(2);
  });

  it("does not match the useEditorMutation.run() spelling used in prose", () => {
    expect(countCodeMatches("  x = useEditorMutation.run();", RUN_RE)).toBe(0);
  });

  it("detects a newly added caller (the drift it exists to catch)", () => {
    const before = "  const r = await mutation.run<D>(async () => {});";
    const after = `${before}\n  const s = await mutation.run<D>(async () => {});`;
    expect(countCodeMatches(before, RUN_RE)).toBe(1);
    expect(countCodeMatches(after, RUN_RE)).toBe(2);
  });

  it("ignores a trailing comment on an otherwise-code line", () => {
    // I2 (review 2026-08-19): a prose mention parked after real code must not
    // stand in for a deleted handler branch.
    const fixture = '  return; // stage === "committed_but_unreloaded" is handled upstream';
    expect(countCodeMatches(fixture, COMMITTED_RE)).toBe(0);
  });

  it("ignores block-comment interior lines that do not begin with *", () => {
    const fixture = ["/*", '  stage === "committed_but_unreloaded" prose', "*/"].join("\n");
    expect(countCodeMatches(fixture, COMMITTED_RE)).toBe(0);
  });

  it("does not mint a phantom caller from a trailing comment", () => {
    expect(countCodeMatches("  const x = 1; // see mutation.run( upstream", RUN_RE)).toBe(0);
  });

  it("counts committed_but_unreloaded branches the same way", () => {
    const fixture = [
      '  // stage === "committed_but_unreloaded" is documented here',
      '  if (result.stage === "committed_but_unreloaded") {',
    ].join("\n");
    expect(countCodeMatches(fixture, COMMITTED_RE)).toBe(1);
  });
});
