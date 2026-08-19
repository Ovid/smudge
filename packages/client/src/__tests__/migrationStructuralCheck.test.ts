import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import {
  collectTsSources,
  delegationPattern,
  importPatternFor,
  runCallPattern,
  stripCommentsFromTsSource,
} from "./tsSourceScan";
import { tmpdir } from "node:os";

// Consolidates the four near-identical "no raw seq-ref patterns" tests that
// used to live one-per-migrated-file (useProjectEditor, useSnapshotState,
// useFindReplaceState, SnapshotPanel). Review S2 (2026-04-22) flagged the
// duplication: lockstep updates were required across four files every time
// the selector evolved, and the ESLint rule already covers the staleness
// *usage* pattern — what these tests uniquely add is a ban on the *naming*
// convention (`*SeqRef`) that would signal someone hand-rolled a new
// counter. One grep across the whole client source tree is enough.
const clientSrcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Extracts every variable name bound from a `useAbortableAsyncOperation()`
// call site. Re-review S1 (2026-05-25) fixed a regex false-pass: the prior
// import-implies-call check used a bare `/\.run\s*\(/` which `useEditorMutation`'s
// `mutation.run(...)` satisfied independently. A file importing both hooks
// (EditorPage.tsx today) could have ALL `useAbortableAsyncOperation`-derived
// `.run(` calls removed and the assertion would silently green-pass on the
// surviving `mutation.run(` — defeating the drift detector. The fix
// extracts binding names from the hook's call sites and checks each
// binding has a matching `<name>.run(` somewhere in the same file. A bare
// receiver-less `.run(` is no longer enough.
//
// Caller is responsible for stripping comments first (see
// stripCommentsFromTsSource) — a future fixture in a comment must not
// extract as a binding. Destructured bindings (`const { run } =
// useAbortableAsyncOperation()`) are intentionally not matched: the
// codebase uses the canonical `const NAME = useAbortableAsyncOperation()`
// shape today, and the absence of a binding name would surface as a
// "no bindings — import is dead" offender, prompting the maintainer to
// either rename the destructure or extend the helper.
export function extractAbortableAsyncOperationBindings(source: string): string[] {
  const pattern = /(?:const|let|var)\s+(\w+)\s*=\s*useAbortableAsyncOperation\s*\(/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    // Capture group 1 is always present when the regex matches — the
    // `(\w+)` is required, not optional. Assert non-undefined to
    // satisfy noUncheckedIndexedAccess.
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

// 4b.3d S13: known delegation helpers — functions that accept an
// AbortableAsyncOperation as an argument and call .run() on it
// internally. A binding passed as an argument to one of these helpers
// satisfies the "binding is consumed" contract just as well as a
// direct <binding>.run() call. The helper itself is unit-tested
// separately (see useTrashManager.refresh.test.ts) to confirm it
// actually calls .run() on the parameter AND that the factory passed
// to .run() invokes the wrapped endpoint with the project's slug and
// the captured signal (review I2, 2026-05-28 — the prior mock shape
// never invoked the factory, so the inner-pipeline guarantee was
// inaccurate; the rewritten mock is a passthrough that exercises the
// real factory). Add new entries here when new delegation helpers
// are introduced.
//
// Limitation (review S1, 2026-05-28): the delegation matcher cannot span a
// nested-paren argument list. It now lives beside its own statement of that
// ceiling in `delegationPattern` (tsSourceScan.ts) — S2, review round 3
// (2026-08-19), which found the shape written out twice here, so the fixture
// test could stay green while the production copy drifted. Both ceilings
// (this one and `runCallPattern`'s) fail toward a false RED rather than a
// silent pass, which is why each is a forcing function rather than drift.
const KNOWN_DELEGATION_HELPERS = ["refreshTrashList"];

describe("client source-tree migration structural check", () => {
  it("no file in packages/client/src (excluding __tests__) uses raw *SeqRef naming", () => {
    const files = collectTsSources(clientSrcRoot);
    const offenders: string[] = [];
    // Pattern covers all three naming shapes the review called out
    // (SeqRef / seqRef / sequenceRef). Word boundary on the left so
    // unrelated words that happen to contain these substrings (there
    // are none today, but future code shouldn't be constrained by a
    // substring collision) don't false-positive.
    const pattern = /\b\w*(SeqRef|seqRef|sequenceRef)\b/;
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      if (pattern.test(source)) {
        offenders.push(file.replace(clientSrcRoot, "packages/client/src"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("collectTsSources skips co-located *.test.ts[x] files as well as __tests__", () => {
    // Proves the S7 (2026-04-23) fix: without the `.test.ts[x]` filename
    // skip, a future fixture like `hooks/someNew.test.ts` that references
    // `xSeqRef` in a string literal (the same trick eslintSequenceRule.test.ts
    // uses inside __tests__/) would false-positive the structural check.
    const sandbox = mkdtempSync(join(tmpdir(), "seqref-structural-"));
    try {
      writeFileSync(join(sandbox, "production.ts"), "export const foo = 1;\n");
      writeFileSync(join(sandbox, "adjacent.test.ts"), "// xSeqRef\n");
      writeFileSync(join(sandbox, "component.test.tsx"), "// ySeqRef\n");
      const files = collectTsSources(sandbox).map((f) => f.slice(sandbox.length + 1));
      expect(files).toEqual(["production.ts"]);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("useAbortableSequence is imported by every file that used to own a seq-ref", () => {
    // The four migration targets. If a file gets moved/renamed the expect
    // on existence fails first with a readable error, rather than silently
    // passing because the file went missing.
    const migrated = [
      resolve(clientSrcRoot, "hooks/useProjectEditor.ts"),
      resolve(clientSrcRoot, "hooks/useSnapshotState.ts"),
      resolve(clientSrcRoot, "hooks/useFindReplaceState.ts"),
      resolve(clientSrcRoot, "components/SnapshotPanel.tsx"),
    ];
    const pattern = importPatternFor("useAbortableSequence");
    for (const file of migrated) {
      const source = readFileSync(file, "utf-8");
      expect(source, `${file} should import useAbortableSequence`).toMatch(pattern);
    }
  });

  it("every binding from useAbortableAsyncOperation is referenced with <binding>.run(", () => {
    // Guards against drift: a file that imports the hook but never
    // calls .run() either has dead code or has had its only call
    // removed without removing the import. Either is a code-smell.
    //
    // S1 (review 2026-05-25): strip comments before testing so a file
    // importing the hook with only a `.run(` in a JSDoc example or
    // explanatory comment can't satisfy the "has at least one call"
    // assertion — that would silence the very drift the check was
    // introduced to catch.
    //
    // S1 (re-review 2026-05-25): the prior `/\.run\s*\(/` regex matched
    // `useEditorMutation`'s `mutation.run(...)` independently of any
    // `useAbortableAsyncOperation` usage. EditorPage.tsx (which imports
    // both hooks AND has live `mutation.run(...)` calls at lines 412/785/1033)
    // would have silently green-passed the assertion even if every
    // useAbortableAsyncOperation-derived `.run(` were removed — the
    // exact drift the check exists to catch. Per-binding pattern
    // (`<name>.run(`) closes the false-pass: `mutation` is not a
    // `useAbortableAsyncOperation()` binding, so its `.run(` does not
    // count. Also strengthens the contract from "at least one .run(
    // somewhere" to "every binding has a matching .run( call" —
    // catches both removal-of-usage AND addition-of-dead-binding drift.
    const importPattern = importPatternFor("useAbortableAsyncOperation");
    const files = collectTsSources(clientSrcRoot);
    const offenders: { file: string; reason: string }[] = [];
    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      if (!importPattern.test(raw)) continue;
      const source = stripCommentsFromTsSource(raw);
      const bindings = extractAbortableAsyncOperationBindings(source);
      const relative = file.replace(clientSrcRoot, "packages/client/src");
      if (bindings.length === 0) {
        offenders.push({
          file: relative,
          reason:
            "imports useAbortableAsyncOperation but has no const NAME = useAbortableAsyncOperation() binding",
        });
        continue;
      }
      for (const name of bindings) {
        // The `<binding>.run(` shape is owned by `runCallPattern`
        // (tsSourceScan.ts), shared with mutationCommittedSurface.test.ts so
        // the two detectors cannot answer differently for the same text. It
        // keeps the word boundary on the LEFT (so `xOp.run(` does not satisfy a
        // search for `p.run(`) and tolerates a generic argument list — NESTED
        // included, as of S4/round 2; the earlier `[^>]*` stopped at the inner
        // `>` and reported a real call as a dead binding.
        if (runCallPattern(name).test(source)) continue;
        // 4b.3d S13: accept delegation — the binding passed as an
        // argument to a known helper that calls .run() internally.
        // The helper's own tests confirm it calls .run() on the param,
        // so this is not a drift-detection hole.
        const delegated = KNOWN_DELEGATION_HELPERS.some((helper) =>
          delegationPattern(helper, name).test(source),
        );
        if (!delegated) {
          offenders.push({
            file: relative,
            reason: `binding "${name}" is never .run() and not delegated to a known helper — dead variable or drifted import`,
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // TODO(Phase 4b.4): encode the "each new signal-bearing API endpoint
  // has ≥1 consumer threading a non-undefined signal" structural
  // assertion. Per design §3.1 last bullet (Phase 4b.3b best-effort).
  // Deferred because the four endpoint shapes are heterogeneous:
  // api.projects.create({...}, s) and api.projects.delete(slug, s) and
  // api.chapters.create(slug, s) match `endpoint(arg, ident)` cleanly,
  // but api.chapterStatuses.list(s) is single-arg signal-only and
  // doesn't fit the same comma-separated regex shape. A simple
  // grep-on-source is too fragile to express the union without false
  // positives or false negatives (e.g. `api.chapterStatuses.list(s)`
  // vs `api.chapterStatuses.list()`). Signal-threading is covered
  // behaviorally by Tasks 11 (C-6), 13 (C-9), 14 (C-10/11), 23 (S-2),
  // 24 (S-7) mock-call assertions — those tests assert each consumer
  // actually passes the live signal through to the API call. The
  // structural assertion is a belt-and-suspenders nicety, not a
  // correctness gate.

  it("importPatternFor matches real imports but not comments, strings, or bare references", () => {
    // Direct exercise of the helper. The prior bare-identifier match
    // (review 2026-05-24, Copilot) accepted comments and string mentions
    // as "imports"; this spec pins the tightened contract so future drift
    // surfaces here rather than in a silent green test.
    const pattern = importPatternFor("useAbortableAsyncOperation");
    // Positive: real ES imports in the shapes the codebase uses today.
    expect(
      pattern.test(`import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";`),
    ).toBe(true);
    expect(
      pattern.test(
        `import { useAbortableAsyncOperation } from "../hooks/useAbortableAsyncOperation";`,
      ),
    ).toBe(true);
    expect(pattern.test(`import { foo, useAbortableAsyncOperation } from "./x";`)).toBe(true);
    expect(pattern.test(`import { useAbortableAsyncOperation, bar } from "./y";`)).toBe(true);
    // Multi-line imports (defensive — single-line today, but the helper
    // shouldn't rot the day someone reformats).
    expect(pattern.test(`import {\n  foo,\n  useAbortableAsyncOperation,\n} from "./x";`)).toBe(
      true,
    );
    // Indented import (e.g. nested in a conditional block — defensive).
    expect(pattern.test(`  import { useAbortableAsyncOperation } from "./z";`)).toBe(true);
    // Negative: the cases the loose regex used to wrongly accept.
    expect(pattern.test(`// useAbortableAsyncOperation lives in ./hooks`)).toBe(false);
    expect(pattern.test(`/* useAbortableAsyncOperation */`)).toBe(false);
    expect(pattern.test(`const s = "useAbortableAsyncOperation";`)).toBe(false);
    expect(pattern.test(`const op = useAbortableAsyncOperation();`)).toBe(false);
    // Word boundary: a longer identifier with the same prefix must not match.
    expect(pattern.test(`import { useAbortableAsyncOperationX } from "./x";`)).toBe(false);
  });

  it("accepts a binding consumed via a known delegation helper (4b.3d S13)", () => {
    // The 4b.3d migration extracted refreshTrashList from useTrashManager.ts.
    // After the migration, trashOp = useAbortableAsyncOperation() is never
    // .run()-ed directly in useTrashManager.ts — it's passed to
    // refreshTrashList, which does .run() internally. The check must
    // accept this pattern; without it, every consumer migrating to a
    // helper would surface as a "dead binding" offender.
    const fixture = `
      import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
      import { refreshTrashList } from "./useTrashManager.refresh";
      function C() {
        const trashOp = useAbortableAsyncOperation();
        const result = refreshTrashList(project, projectRef, slugRef, trashOp);
        return result;
      }
    `;
    const bindings = extractAbortableAsyncOperationBindings(fixture);
    expect(bindings).toEqual(["trashOp"]);
    // The direct .run( pattern does NOT match (no `trashOp.run(` in source).
    expect(runCallPattern(bindings[0]).test(fixture)).toBe(false);
    // The delegation pattern DOES match (trashOp appears as an argument
    // to refreshTrashList). Both patterns are the same functions the
    // production check calls, so this fixture cannot pin a shape the
    // production copy has drifted away from (S2, review round 3).
    expect(delegationPattern("refreshTrashList", bindings[0]).test(fixture)).toBe(true);
  });

  it("extractAbortableAsyncOperationBindings extracts hook bindings and rejects mutation.run drift (S1 re-review 2026-05-25)", () => {
    // Direct exercise of the helper that powers the import-implies-call
    // assertion. Pins the contract that the per-binding `.run(` pattern
    // distinguishes `useAbortableAsyncOperation`-derived ops from
    // `useEditorMutation`'s `mutation.run(...)`. Without this, the prior
    // bare `/\.run\s*\(/` regex silently green-passed for files importing
    // both hooks (EditorPage.tsx in particular) — the exact drift the
    // structural check exists to catch.

    // Positive: real bindings in the shapes the codebase uses today.
    expect(
      extractAbortableAsyncOperationBindings("const saveOp = useAbortableAsyncOperation();"),
    ).toEqual(["saveOp"]);
    expect(
      extractAbortableAsyncOperationBindings("  const op = useAbortableAsyncOperation()"),
    ).toEqual(["op"]);
    expect(
      extractAbortableAsyncOperationBindings(
        "const a = useAbortableAsyncOperation();\nconst b = useAbortableAsyncOperation();\n",
      ),
    ).toEqual(["a", "b"]);
    // Multi-line assignment (defensive — single-line today, but the
    // helper shouldn't rot the day someone reformats).
    expect(
      extractAbortableAsyncOperationBindings("const x =\n  useAbortableAsyncOperation();"),
    ).toEqual(["x"]);
    // let/var (defensive — codebase uses const, but the regex shouldn't
    // exclude future hoisted patterns).
    expect(
      extractAbortableAsyncOperationBindings("let lateOp = useAbortableAsyncOperation();"),
    ).toEqual(["lateOp"]);

    // Negative: the cases the loose regex used to wrongly conflate.
    expect(
      extractAbortableAsyncOperationBindings("const mutation = useEditorMutation({});"),
    ).toEqual([]);
    expect(
      extractAbortableAsyncOperationBindings("mutation.run(async () => ({ ok: true }));"),
    ).toEqual([]);
    // Word boundary on the LEFT so `useAbortableAsyncOperationLike` etc.
    // doesn't false-positive.
    expect(
      extractAbortableAsyncOperationBindings("const x = useAbortableAsyncOperationLike();"),
    ).toEqual([]);

    // Drift scenario: file imports both hooks, has a useAbortableAsyncOperation()
    // binding that is NEVER `.run()`-ed, and a `mutation.run<T>(...)` call from
    // useEditorMutation (with the generic-arg form EditorPage.tsx actually
    // uses). The bare regex would have accepted this; the per-binding
    // pattern with the same generic-aware shape must reject it.
    const driftFixture = `
      import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
      import { useEditorMutation } from "./useEditorMutation";
      function C() {
        const someOp = useAbortableAsyncOperation();
        const mutation = useEditorMutation({});
        mutation.run<RestoreData>(async () => ({ ok: true }));
      }
    `;
    const bindings = extractAbortableAsyncOperationBindings(driftFixture);
    expect(bindings).toEqual(["someOp"]);
    // someOp.run( does NOT appear; mutation.run<T>( does. The per-binding
    // pattern (with optional generic args) correctly rejects this.
    expect(runCallPattern(bindings[0]).test(driftFixture)).toBe(false);

    // Positive companion: the same pattern matches a real generic-arg
    // call when the receiver IS a hook binding. saveOp.run<SaveLoopOutcome>(...)
    // in useProjectEditor.ts:385 is the live example.
    const liveFixture = `
      const saveOp = useAbortableAsyncOperation();
      const { promise: saveRunPromise } = saveOp.run<SaveLoopOutcome>(async (s) => fetch(s));
    `;
    const liveBindings = extractAbortableAsyncOperationBindings(liveFixture);
    expect(liveBindings).toEqual(["saveOp"]);
    expect(runCallPattern(liveBindings[0]).test(liveFixture)).toBe(true);
  });

  it("runCallPattern answers identically for both detectors (S4, review 2026-08-19)", () => {
    // S4: the `<binding>.run(` matcher was duplicated here and in
    // mutationCommittedSurface.test.ts, and the copies had diverged — the
    // newer one tolerated a Prettier line-wrap and optional chaining, this
    // one tolerated neither. The same source text got two different answers
    // from two detectors scanning the same tree for the same construct, and
    // here the wrapped shape produced a false RED (a cosmetic reflow of a
    // real `.run(` call would report the binding as dead). One shared
    // parameterised pattern in tsSourceScan.ts owns the shape now.
    const pattern = runCallPattern("saveOp");
    expect(pattern.test("saveOp.run(f);")).toBe(true);
    expect(pattern.test("saveOp.run<SaveLoopOutcome>(f);")).toBe(true);
    // The three shapes this copy used to miss.
    expect(pattern.test("await saveOp\n  .run(f);")).toBe(true);
    expect(pattern.test("saveOp?.run(f);")).toBe(true);
    // Nested generic (review I2): `[^>]*` stopped at the inner `>`.
    expect(pattern.test("saveOp.run<Array<string>>(f);")).toBe(true);
    // Word boundary on the LEFT survives the rewrite.
    expect(pattern.test("xsaveOp.run(f);")).toBe(false);
  });

  it("stripCommentsFromTsSource does not treat a comment token inside a string as a comment (S6)", () => {
    // S6 (review 2026-08-19): the stripper moved out of this file verbatim,
    // where every consumer was a PRESENCE check. mutationCommittedSurface.ts
    // now derives equality-of-COUNTS decisions from its output, so
    // over-stripping flips a numeric assertion instead of a boolean — and a
    // dropped binding silently removes a file from caller discovery.
    //
    // The concrete latent failure: a glob string containing `/*` opened a
    // block comment that ran to the next `*/` anywhere below, erasing every
    // line in between. Confirmed no such literal exists in packages/client/src
    // today; this pins the behaviour so one landing later is harmless.
    const globAboveBinding = [
      'const files = glob("**/*.ts");',
      "const mutation = useEditorMutation({});",
      "await mutation.run(f); /* trailing */",
    ].join("\n");
    expect(stripCommentsFromTsSource(globAboveBinding)).toContain(
      "const mutation = useEditorMutation({});",
    );
    expect(stripCommentsFromTsSource(globAboveBinding)).toContain("mutation.run(f);");
    // A comment token inside a string stays; a real comment beside it goes.
    expect(stripCommentsFromTsSource(`const s = "a // b"; // gone`)).toBe(`const s = "a // b"; `);
    expect(stripCommentsFromTsSource("const s = 'a /* b */ c';")).toBe("const s = 'a /* b */ c';");
    // S3 (review round 3, 2026-08-19): a REGEX literal containing a quote used
    // to be read as opening a string, which swallowed the real comment below
    // it. Regex literals are now passed through verbatim, like strings.
    const regexLiteral = ['const re = /"/;', '// a " mention', "const x = 1;"].join("\n");
    const strippedRegexLiteral = stripCommentsFromTsSource(regexLiteral);
    expect(strippedRegexLiteral).toContain('const re = /"/;');
    expect(strippedRegexLiteral).not.toContain("//");
    // Division is NOT mistaken for a regex — the lookbehind requires a
    // position where a regex may legally begin.
    expect(stripCommentsFromTsSource("const r = a / b; // gone")).toBe("const r = a / b; ");
  });

  it("a regex literal containing a quote does not erase the code below it (S3)", () => {
    // S3 (review round 3, 2026-08-19): the ceiling above was false in its
    // load-bearing half. A regex literal read as an opening quote pairs with
    // the NEXT quote, and the scanner then resumes mid-expression — where a
    // `/*` inside a glob string can open a block comment that runs to the next
    // real `*/` anywhere below, DELETING every line in between. Counts go DOWN,
    // so a file silently drops out of mutationCommittedSurface's caller
    // discovery: the silent green that ceiling promised was impossible.
    const erasure = [
      'const re = /"/;',
      'const files = glob("**/*.ts");',
      "const mutation = useEditorMutation({});",
      "await mutation.run(f);",
      "/* an ordinary block comment further down */",
      "export {};",
    ].join("\n");
    const stripped = stripCommentsFromTsSource(erasure);
    expect(stripped).toContain("const mutation = useEditorMutation({});");
    expect(stripped).toContain("await mutation.run(f);");
  });

  it("stripCommentsFromTsSource removes line and block comments (S1/S3)", () => {
    // The helper pins S1/S3 behavior: structural checks must see only
    // executable code, never commented mentions. If this contract drifts
    // (e.g. someone naively tries to strip comments with a non-greedy
    // pattern that crosses adjacent blocks), the downstream import
    // check would silently re-acquire the false-pass risk.
    expect(stripCommentsFromTsSource("const x = 1; // comment\n")).toBe("const x = 1; \n");
    expect(stripCommentsFromTsSource("const /* inline */ y = 2;")).toBe("const  y = 2;");
    expect(stripCommentsFromTsSource("/* multi\n  line */\nconst z = 3;")).toBe("\nconst z = 3;");
    // Adjacent block comments must NOT merge into one greedy match.
    expect(stripCommentsFromTsSource("/* a */ x /* b */")).toBe(" x ");
    // Live code with patterns that LOOK like comments inside strings is
    // left as-is on the string side — the helper is a presence-filter,
    // not a full JS parser. This is fine for our use because the
    // downstream checks look for code-shape patterns (useRef<…>, .run()),
    // not for the absence of strings.
    expect(stripCommentsFromTsSource("// hide\nconst live = 'x';")).toBe("\nconst live = 'x';");
    // A real `.run(` survives stripping; a commented one does not.
    expect(stripCommentsFromTsSource("foo.run(s); // comment-form: bar.run(s)")).toContain(
      "foo.run(s);",
    );
    expect(stripCommentsFromTsSource("// foo.run(s)\nconst x = 1;")).not.toContain("foo.run");
    // A real useRef<AbortController> survives; a commented one does not.
    expect(stripCommentsFromTsSource("// useRef<AbortController>\nconst r = 1;")).not.toContain(
      "useRef<AbortController>",
    );
    expect(stripCommentsFromTsSource("const r = useRef<AbortController | null>(null);")).toContain(
      "useRef<AbortController",
    );
  });
});
