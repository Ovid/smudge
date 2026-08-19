import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  collectTsSources,
  importPatternFor,
  runCallPattern,
  stripCommentsFromTsSource,
} from "./tsSourceScan";

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
//   ***
//   *** AND read F-07's Status block first (S10, review round 3). A THIRD
//   *** caller is the recorded trigger for moving the terminal dispatch into
//   *** run() itself, which is the only option that makes this failure
//   *** structurally impossible. That was deferred on cost, not rejected —
//   *** "remains available and is the right one if a third consumer ever
//   *** lands". Adding a third by-hand handler is the thing that decision says
//   *** not to do by reflex. Nothing else ties the decision to this trigger.
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
// handler — and because one run() may legitimately need two comparisons (the
// two-sub-case shape above). Both quantities are therefore recorded SEPARATELY
// in COMMITTED_CALLERS (S4, review round 3, 2026-08-19): a single integer
// asserted against both the run-call count and the committed-branch count could
// not encode either divergence, so the only route back to green would have been
// to weaken a detector. Recording them apart keeps a real divergence a decision
// the author writes down, and still fails LOUDLY when either number moves
// without one — the safe failure direction.
//
// Discovery is keyed on the useEditorMutation HANDLE BINDING, not on a receiver
// spelled `mutation` — see HANDLE_RE below for why (review I1, 2026-08-19).
//
// The counting pass sees `<handle>.run(` and nothing else. Review I2
// (2026-08-19) corrected an earlier claim here that any other spelling "fails
// toward red": that holds only when an unseen shape REPLACES a counted call.
// Add one and both numbers are unchanged, so the unguarded caller ships GREEN.
// The two shapes a caller could plausibly reach for — `const { run } = mutation`
// and the one-step `const { run } = useEditorMutation({...})` — are therefore
// refused outright by findUncountableRunShapes below rather than relied on to
// fail. If you need a spelling neither the counter nor the refusal covers,
// extend one of them; do not assume the numbers will notice.

const clientSrc = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const COMMITTED_RE = /stage === "committed_but_unreloaded"/;

// The three spellings that name the hook where a handle is bound:
//
//   const NAME = useEditorMutation({...})           // the owner constructs it
//   NAME: ReturnType<typeof useEditorMutation>      // a consumer declares it
//   NAME: UseEditorMutationReturn                   // ...or names the return type
//
// These are NOT exhaustive, and TypeScript forces none of them: a one-step
// `const { run } = useEditorMutation({...})` destructure binds no name, and a
// deps interface hoisted into a sibling *.types.ts moves the declaration out
// of the consuming file entirely. Both were verified to yield [] here (review
// I1, 2026-08-19). discoverCallers() therefore does not rely on this regex
// alone — see its three signals.
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

/**
 * Every useEditorMutation handle name bound in `source` (comments stripped),
 * plus any local name bound directly from one — `const mutationRef =
 * useRef(mutation)`. The alias hop exists because a call through a ref reads
 * `mutationRef.current.run(...)`, whose receiver is not the handle name, and
 * this codebase reaches for latest-refs constantly (I2, review 2026-08-19).
 */
export function extractMutationHandles(source: string): string[] {
  const code = stripCommentsFromTsSource(source);
  const names = new Set<string>();
  for (const match of code.matchAll(HANDLE_RE)) {
    const name = match[1] ?? match[2];
    if (name !== undefined) names.add(name);
  }
  for (const base of [...names]) {
    const aliasRe = new RegExp(
      `(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:useRef\\s*(?:<[^()]*>)?\\s*\\(\\s*)?(?:\\w+\\.)*\\b${base}\\b\\s*[),;\\n]`,
      "g",
    );
    for (const match of code.matchAll(aliasRe)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return [...names];
}

// The one-step `const { run } = useEditorMutation({...})` destructure, refused
// WITHOUT reference to any handle name.
//
// I2 (review round 3, 2026-08-19): this shape binds no handle and calls no
// `<handle>.run(`, so the only trace it leaves is the import — and the import
// signal added for it in round 2 merely converts a file from INVISIBLE to
// LISTED. A file already in COMMITTED_CALLERS gains no key, no run count and no
// committed branch from it, so both numeric assertions compare unchanged
// numbers and the unguarded caller ships green. pages/EditorPage.tsx is listed
// and owns the shared instance, making it the single most likely host.
//
// The handle loop above cannot reach it: `useEditorMutation` is spelled with a
// capital M, so `\bmutation\b` finds no word boundary inside it.
const ONE_STEP_DESTRUCTURE_RE = /\{[^{}]*\brun\b[^{}]*\}\s*=\s*[^;\n]*useEditorMutation\s*[<(]/;

/**
 * Run-call shapes in `source` that `countMutationRuns` cannot attribute.
 *
 * I2 (review 2026-08-19): the header used to claim an unseen call shape "drops
 * the file's run count below its committed count and so fails red too". That
 * holds only when an unseen shape REPLACES a counted call. Add one — the
 * "third caller lands" case this file exists to block — and the count is
 * simply unchanged, so both assertions compare unchanged numbers and the
 * unguarded caller ships green. Counting receiver-blind was considered and
 * rejected: all three handle-holding files also hold `useAbortableAsyncOperation`
 * bindings and TipTap command chains that end in `.run()`, so a blind count
 * false-reds on every one of them. Naming the one unattributable shape and
 * refusing it is the narrower fix.
 *
 * `handles` defaults to the file's own bindings and is widened tree-wide by the
 * offender test, exactly as `countMutationRuns` already is (I1, review round 3,
 * 2026-08-19). Without the widening the two fixes disagreed about which handle
 * set to scan, so their INTERSECTION stayed open: a caller whose deps type is
 * hoisted into a sibling *.types.ts (no local binding, so nothing to iterate)
 * AND which destructures run() off that deps property (so nothing to count)
 * escaped both. Over-flagging an unrelated handle name fails toward a false RED,
 * the direction this file declares safe.
 */
export function findUncountableRunShapes(
  source: string,
  handles: string[] = extractMutationHandles(source),
): string[] {
  const code = stripCommentsFromTsSource(source);
  const reasons: string[] = [];
  for (const name of handles) {
    const destructure = new RegExp(`\\{[^{}]*\\brun\\b[^{}]*\\}\\s*=\\s*[^;\\n]*\\b${name}\\b`);
    if (destructure.test(code)) reasons.push(`destructures run() off the \`${name}\` handle`);
  }
  if (ONE_STEP_DESTRUCTURE_RE.test(code)) {
    reasons.push("destructures run() straight off useEditorMutation()");
  }
  return reasons;
}

/**
 * Counts `<handle>.run(...)` calls in `source`.
 *
 * `handles` defaults to the file's own bindings; discoverCallers passes the
 * names bound ANYWHERE in the tree instead, so a consumer whose deps type was
 * hoisted into a sibling *.types.ts is still counted (I1, review 2026-08-19).
 *
 * The call shape is owned by `runCallPattern` in tsSourceScan.ts, shared with
 * the sibling drift detector (S4, review 2026-08-19) so the two cannot answer
 * differently for the same text. A `const { run } = mutation` destructure is
 * deliberately NOT matched here — it is caught by its own offender assertion
 * below (I2, review 2026-08-19), because a destructure that ADDS a call
 * rather than replacing one leaves the count unchanged and passes green.
 */
export function countMutationRuns(
  source: string,
  handles: string[] = extractMutationHandles(source),
): number {
  const code = stripCommentsFromTsSource(source);
  let total = 0;
  for (const name of handles) {
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

type CommittedCaller = {
  /** `<handle>.run(` calls the file makes. */
  runs: number;
  /** `stage === "committed_but_unreloaded"` comparisons the file makes. */
  committedBranches: number;
};

// The two numbers are independent on purpose (S4, review round 3). They are
// equal at every current call site, but nothing requires that: two run() calls
// funnelled through one shared handler give runs > committedBranches, and one
// run() whose handler splits the on-target and drifted sub-cases across two
// comparisons gives committedBranches > runs. Either is a legitimate shape the
// author must be able to write down.
const COMMITTED_CALLERS: Record<string, CommittedCaller> = {
  "hooks/useFindReplaceController.ts": { runs: 2, committedBranches: 2 },
  "hooks/useSnapshotController.ts": { runs: 1, committedBranches: 1 },
  // Owner: constructs the shared instance, calls run() nowhere.
  "pages/EditorPage.tsx": { runs: 0, committedBranches: 0 },
};

/**
 * Every production source in the client tree, paired with the handle names
 * bound ANYWHERE in it.
 *
 * The tree-wide set exists because a consumer that receives `mutation` from a
 * deps interface declared in a sibling *.types.ts binds no handle of its own
 * (I1, review 2026-08-19). BOTH scanning passes below take it: keying one pass
 * on tree-wide names and the other on per-file names is what left their
 * intersection open (I1, review round 3). Over-matching an unrelated
 * `mutation.run(` elsewhere fails in the safe direction — a false RED demanding
 * a decision.
 */
function loadClientTree(): { files: (readonly [string, string])[]; allHandles: string[] } {
  const files = collectTsSources(clientSrc).map(
    (file) => [file, readFileSync(file, "utf8")] as const,
  );
  return {
    files,
    allHandles: [...new Set(files.flatMap(([, source]) => extractMutationHandles(source)))],
  };
}

function discoverCallers(): Record<string, number> {
  const { files, allHandles } = loadClientTree();
  const importsHook = importPatternFor("useEditorMutation");
  const found: Record<string, number> = {};
  for (const [file, source] of files) {
    // Three independent signals, because no one of them covers the others:
    //   - holds a handle: the owner that makes no run() call is still listed
    //     (EditorPage.tsx, count 0), so the day it starts calling run() the
    //     surface assertion goes red rather than silently acquiring a caller;
    //   - calls run() on a tree-wide handle name: the sibling-.types.ts shape;
    //   - imports the hook: `const { run } = useEditorMutation({...})` binds no
    //     handle and calls no `<handle>.run(`, leaving the import as the only
    //     trace. The sibling detector already treats "imports the hook but
    //     yields no binding" as an offender rather than a skip
    //     (migrationStructuralCheck.test.ts) — this is the same gate.
    const runs = countMutationRuns(source, allHandles);
    if (extractMutationHandles(source).length === 0 && runs === 0 && !importsHook.test(source)) {
      continue;
    }
    found[file.slice(clientSrc.length + 1)] = runs;
  }
  return found;
}

describe("useEditorMutation caller surface (F-07 forcing pause)", () => {
  it("has exactly the committed set of mutation.run() callers", () => {
    const expected = Object.fromEntries(
      Object.entries(COMMITTED_CALLERS).map(([file, { runs }]) => [file, runs]),
    );
    expect(discoverCallers()).toEqual(expected);
  });

  it("no file reaches run() through a shape the count cannot see", () => {
    // The counting assertion above only compares numbers. A call added in a
    // shape countMutationRuns cannot attribute leaves both numbers unchanged
    // and ships green (I2, review 2026-08-19), so the shape itself is banned.
    const offenders: string[] = [];
    const { files, allHandles } = loadClientTree();
    for (const [file, source] of files) {
      for (const reason of findUncountableRunShapes(source, allHandles)) {
        offenders.push(`${file.slice(clientSrc.length + 1)}: ${reason}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(Object.keys(COMMITTED_CALLERS))(
    "%s handles committed_but_unreloaded for every run() it makes",
    (relPath) => {
      const source = readFileSync(resolve(clientSrc, relPath), "utf8");
      expect(countCodeMatches(source, COMMITTED_RE)).toBe(
        COMMITTED_CALLERS[relPath].committedBranches,
      );
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

describe("caller discovery reaches past the declaring file (I1)", () => {
  // I1 (review 2026-08-19): discoverCallers() skipped any file yielding no
  // handle of its own. A new caller whose deps type is declared in a sibling
  // *.types.ts (useProjectEditor.types.ts is the established local precedent
  // for exactly that hoist) contributes no key, so the surface assertion stays
  // GREEN — the one direction this file exists to block. Two widenings close
  // it: the tree-wide handle-name set, and the import edge.

  it("counts a run() in a file whose deps type lives in a sibling module", () => {
    const consumer = [
      'import type { FindReplaceControllerDeps } from "./useFindReplaceController.types";',
      "export function useC(deps: FindReplaceControllerDeps) {",
      "  return deps.mutation.run(f);",
      "}",
    ].join("\n");
    // Invisible when only its own bindings are considered...
    expect(extractMutationHandles(consumer)).toEqual([]);
    // ...visible against the handle names the tree declares elsewhere.
    expect(countMutationRuns(consumer, ["mutation"])).toBe(1);
  });

  it("sees the import edge for a file that binds no handle at all", () => {
    const oneStepDestructure = [
      'import { useEditorMutation } from "../hooks/useEditorMutation";',
      "const { run } = useEditorMutation({ editorRef, projectEditor, dispatch });",
      "await run(f);",
    ].join("\n");
    expect(extractMutationHandles(oneStepDestructure)).toEqual([]);
    expect(countMutationRuns(oneStepDestructure, ["mutation"])).toBe(0);
    // The import is the only remaining signal — and it must fire.
    expect(importPatternFor("useEditorMutation").test(oneStepDestructure)).toBe(true);
  });

  it("matches a type-only import of the hook", () => {
    // Both live controllers reach useEditorMutation this way.
    const src = 'import type { useEditorMutation } from "./useEditorMutation";';
    expect(importPatternFor("useEditorMutation").test(src)).toBe(true);
  });
});

describe("uncountable run() shapes (I2 additive hole)", () => {
  // I2 (review 2026-08-19): countMutationRuns only sees `<handle>.run(`. The
  // file header used to claim that an unseen shape "drops the file's run count
  // below its committed count and so fails red too". That is true when an
  // unseen shape REPLACES a counted call. It is false when one is ADDED — the
  // count is simply unchanged, both assertions compare unchanged numbers, and
  // the new unguarded caller ships green. That additive case is exactly the
  // "third caller lands" scenario this file exists to block.

  it("flags a run() destructured off a handle (the additive shape)", () => {
    const fixture = [
      "const mutation = useEditorMutation({});",
      "await mutation.run(f);",
      "const { run } = mutation;",
      "await run(g);",
    ].join("\n");
    // The added call contributes nothing to the count...
    expect(countMutationRuns(fixture)).toBe(1);
    // ...so the shape itself must be the offender.
    expect(findUncountableRunShapes(fixture)).toEqual([
      "destructures run() off the `mutation` handle",
    ]);
  });

  it("flags a destructure off a deps-property handle", () => {
    const fixture = [
      "type D = { mutation: ReturnType<typeof useEditorMutation> };",
      "const { run } = deps.mutation;",
    ].join("\n");
    expect(findUncountableRunShapes(fixture)).toEqual([
      "destructures run() off the `mutation` handle",
    ]);
  });

  it("flags a one-step destructure straight off useEditorMutation()", () => {
    // I2 (review round 3, 2026-08-19): the import signal added for this shape
    // only converts a file from INVISIBLE to LISTED. A file already on the
    // committed surface — pages/EditorPage.tsx above all, which owns the shared
    // instance — gains no key, no run count and no committed branch from it, so
    // both numeric assertions compare unchanged numbers and it ships green.
    // The refusal must therefore be handle-INDEPENDENT: `useEditorMutation` is
    // spelled with a capital M, so `\bmutation\b` never matches it.
    const fixture = [
      "const mutation = useEditorMutation({});",
      "await mutation.run(f);",
      "const { run } = useEditorMutation({ editorRef, projectEditor, dispatch });",
      "await run(g);",
    ].join("\n");
    expect(countMutationRuns(fixture)).toBe(1);
    expect(findUncountableRunShapes(fixture)).toEqual([
      "destructures run() straight off useEditorMutation()",
    ]);
  });

  it("says nothing about a file that spells every call canonically", () => {
    const fixture = "const mutation = useEditorMutation({});\nawait mutation.run(f);";
    expect(findUncountableRunShapes(fixture)).toEqual([]);
  });

  it("does not flag an unrelated destructure that merely mentions the handle", () => {
    const fixture = [
      "const mutation = useEditorMutation({});",
      "const { isBusy } = mutation;",
      "const { run } = replaceOp;",
    ].join("\n");
    expect(findUncountableRunShapes(fixture)).toEqual([]);
  });

  it("counts an ADDED nested-generic call rather than ignoring it (S4 pattern fix)", () => {
    const before = "const mutation = useEditorMutation({});\nawait mutation.run<D>(f);";
    const after = `${before}\nawait mutation.run<Array<string>>(g);`;
    expect(countMutationRuns(before)).toBe(1);
    expect(countMutationRuns(after)).toBe(2);
  });

  it("counts a call through a ref-held handle", () => {
    const fixture = [
      "const mutation = useEditorMutation({});",
      "const mutationRef = useRef(mutation);",
      "await mutationRef.current.run(f);",
    ].join("\n");
    expect(countMutationRuns(fixture)).toBe(1);
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

  it("finds the handle even when run() is destructured off it", () => {
    // A destructured `run` is not counted as a call. This used to be
    // described as "fails toward red" — true only when the destructure
    // REPLACES a counted call. When it ADDS one the count is unchanged and
    // the caller ships green, so the shape is refused outright by
    // findUncountableRunShapes rather than relied on to fail.
    const fixture = "const mutation = useEditorMutation({});\nconst { run } = mutation;\nrun(f);";
    expect(extractMutationHandles(fixture)).toEqual(["mutation"]);
    expect(countMutationRuns(fixture)).toBe(0);
    expect(findUncountableRunShapes(fixture)).toHaveLength(1);
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

describe("uncountable shapes reach past the declaring file (I1 ∩ I2)", () => {
  // I1 (review 3, 2026-08-19): discoverCallers() counts run() calls against
  // handle names bound ANYWHERE in the tree, but findUncountableRunShapes was
  // left scanning only the file's OWN bindings. A caller that combines both
  // shapes — deps type hoisted into a sibling *.types.ts AND run() destructured
  // off the deps property — escapes the counter (no local binding) and the
  // offender pass (no local handle to iterate), so it ships green.

  it("flags a destructure off a handle the scanned file does not itself bind", () => {
    const consumer = [
      'import type { XDeps } from "./useX.types";',
      "export function useX(deps: XDeps) {",
      "  const { run } = deps.mutation;",
      "  return run(async () => {});",
      "}",
    ].join("\n");
    expect(extractMutationHandles(consumer)).toEqual([]);
    expect(countMutationRuns(consumer, ["mutation"])).toBe(0);
    expect(findUncountableRunShapes(consumer, ["mutation"])).toEqual([
      "destructures run() off the `mutation` handle",
    ]);
  });
});
