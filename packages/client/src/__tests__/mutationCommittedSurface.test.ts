import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { collectTsSources, runCallPattern, stripCommentsFromTsSource } from "./tsSourceScan";

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
//
// Discovery is keyed on the useEditorMutation HANDLE BINDING, not on a receiver
// spelled `mutation` — see HANDLE_RE below for why (review I1, 2026-08-19). The
// one remaining shape it cannot see, `const { run } = mutation`, drops the
// file's run count below its committed count and so fails red too.

const clientSrc = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const COMMITTED_RE = /stage === "committed_but_unreloaded"/;

// A file can obtain a useEditorMutation handle exactly two ways, and
// TypeScript forces the hook's own name to be spelled out in both:
//
//   const NAME = useEditorMutation({...})           // the owner constructs it
//   NAME: ReturnType<typeof useEditorMutation>      // a consumer declares it
//   NAME: UseEditorMutationReturn                   // ...or names the return type
//
// I1 (review 2026-08-19): discovery used to be `/\bmutation\.run\s*[<(]/` —
// keyed on the literal receiver name. A third caller spelling its handle
// `editorMutation`, `snapshotMutation`, `mutationRef.current`, or reaching it
// through `mutation?.run(` added NO key to discoverCallers(), so the surface
// assertion stayed green: the single failure mode this file exists to prevent
// was the one that slipped through. Non-`mutation` handle names are established
// local habit (every useAbortableAsyncOperation handle is `<x>Op`, including
// ImageGallery.tsx's `mutationOp`). Extracting the binding name first — the
// same fix migrationStructuralCheck.test.ts applied to its own receiver-blind
// `.run(` check — removes the naming dependency.
const HANDLE_RE =
  /(?:(?:const|let|var)\s+(\w+)\s*=\s*useEditorMutation\s*[<(]|(\w+)\s*\??\s*:\s*(?:ReturnType\s*<\s*typeof\s+useEditorMutation\s*>|UseEditorMutationReturn))/g;

/** Every useEditorMutation handle name bound in `source` (comments stripped). */
export function extractMutationHandles(source: string): string[] {
  const code = stripCommentsFromTsSource(source);
  const names = new Set<string>();
  for (const match of code.matchAll(HANDLE_RE)) {
    const name = match[1] ?? match[2];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/**
 * Counts `<handle>.run(...)` calls in `source` for every handle it binds.
 *
 * The call shape is owned by `runCallPattern` in tsSourceScan.ts, shared with
 * the sibling drift detector (S4, review 2026-08-19) so the two cannot answer
 * differently for the same text. A `const { run } = mutation` destructure is
 * deliberately NOT matched here — it is caught by its own offender assertion
 * below (I2, review 2026-08-19), because a destructure that ADDS a call
 * rather than replacing one leaves the count unchanged and passes green.
 */
export function countMutationRuns(source: string): number {
  const code = stripCommentsFromTsSource(source);
  let total = 0;
  for (const name of extractMutationHandles(source)) {
    total += code.match(runCallPattern(name, "g"))?.length ?? 0;
  }
  return total;
}

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
  // Owner: constructs the shared instance, calls run() nowhere.
  "pages/EditorPage.tsx": 0,
};

function discoverCallers(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of collectTsSources(clientSrc)) {
    const source = readFileSync(file, "utf8");
    // Every file HOLDING a handle is listed, including the owner that makes no
    // run() call (EditorPage.tsx, count 0). Listing it means the day it starts
    // calling run() the surface assertion goes red rather than silently
    // acquiring an unguarded caller.
    if (extractMutationHandles(source).length === 0) continue;
    found[file.slice(clientSrc.length + 1)] = countMutationRuns(source);
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
  const HANDLE = "const mutation = useEditorMutation({});";

  it("counts real calls and ignores the same text in comments", () => {
    const fixture = [
      HANDLE,
      "  // await mutation.run(...) is the seam every caller routes through",
      "  /* mutation.run( in a block comment */",
      "  /**",
      "   * mutation.run( in a jsdoc continuation",
      "   */",
      "  const a = await mutation.run<Data>(async () => {});",
      "  const b = await mutation.run(async () => {});",
    ].join("\n");
    expect(countMutationRuns(fixture)).toBe(2);
  });

  it("does not match the useEditorMutation.run() spelling used in prose", () => {
    expect(countMutationRuns(`${HANDLE}\n  x = useEditorMutation.run();`)).toBe(0);
  });

  it("detects a newly added caller (the drift it exists to catch)", () => {
    const before = `${HANDLE}\n  const r = await mutation.run<D>(async () => {});`;
    const after = `${before}\n  const s = await mutation.run<D>(async () => {});`;
    expect(countMutationRuns(before)).toBe(1);
    expect(countMutationRuns(after)).toBe(2);
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
    const fixture =
      "const mutation = useEditorMutation({});\nconst x = 1; // see mutation.run( upstream";
    expect(countMutationRuns(fixture)).toBe(0);
  });

  it("counts committed_but_unreloaded branches the same way", () => {
    const fixture = [
      '  // stage === "committed_but_unreloaded" is documented here',
      '  if (result.stage === "committed_but_unreloaded") {',
    ].join("\n");
    expect(countCodeMatches(fixture, COMMITTED_RE)).toBe(1);
  });
});

describe("mutation-handle discovery (I1 alias spellings)", () => {
  // I1 (review 2026-08-19): discovery used to key on the literal receiver
  // name `mutation`, so a third caller spelling its handle anything else
  // added no key and the surface assertion stayed GREEN — the one direction
  // this file exists to block. Each case below returned 0 under that regex.
  const CASES: [string, string, number][] = [
    ["canonical receiver", "const mutation = useEditorMutation({});\nmutation.run(f);", 1],
    [
      "deps property access",
      "type D = { mutation: ReturnType<typeof useEditorMutation> };\ndeps.mutation.run(f);",
      1,
    ],
    ["aliased handle", "const editorMutation = useEditorMutation({});\neditorMutation.run(f);", 1],
    [
      "deps-typed alias",
      "type D = { snapshotMutation: ReturnType<typeof useEditorMutation> };\nsnapshotMutation.run<T>(f);",
      1,
    ],
    ["named return type", "type D = { mut: UseEditorMutationReturn };\nmut.run(f);", 1],
    ["optional chaining", "const mutation = useEditorMutation({});\nmutation?.run(f);", 1],
    [
      "prettier line wrap",
      "const mutation = useEditorMutation({});\nawait mutation\n  .run(f);",
      1,
    ],
  ];
  it.each(CASES)("counts a run() through a %s handle", (_label, fixture, expected) => {
    expect(countMutationRuns(fixture)).toBe(expected);
  });

  it("finds the handle even when run() is destructured off it (fails toward red)", () => {
    // A destructured `run` is not counted as a call, so the file reports
    // fewer runs than COMMITTED_CALLERS records — a false RED demanding a
    // decision, never a silent green.
    const fixture = "const mutation = useEditorMutation({});\nconst { run } = mutation;\nrun(f);";
    expect(extractMutationHandles(fixture)).toEqual(["mutation"]);
    expect(countMutationRuns(fixture)).toBe(0);
  });

  it("ignores handles and calls that live in comments", () => {
    const fixture = "// const mutation = useEditorMutation({});\n/* mutation.run(f); */";
    expect(extractMutationHandles(fixture)).toEqual([]);
    expect(countMutationRuns(fixture)).toBe(0);
  });

  it("does not treat a same-prefixed identifier as a handle", () => {
    const fixture = "const mutationOp = useAbortableAsyncOperation();\nmutationOp.run(f);";
    expect(extractMutationHandles(fixture)).toEqual([]);
    expect(countMutationRuns(fixture)).toBe(0);
  });
});
