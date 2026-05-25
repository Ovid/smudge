import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
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

// Pattern shared between the source-tree migration check and the regex
// drift-spec test below. Keep in lockstep — if you change the regex, the
// spec test is what pins the new contract.
//
// S2 (review 2026-05-25): broadened to match AbortController anywhere
// inside the generic argument list — not just as the first/sole token.
// Pre-fix `/useRef\s*<\s*AbortController\b[^>]*>/` required AbortController
// to be the FIRST token after `<`, which silently let nested generics
// like `useRef<Record<string, AbortController>>` slip through. Future
// per-key cancellation patterns would have false-passed the structural
// check. The new shape `[^>]*\bAbortController\b` doesn't require a
// closing `>` (because nested generics carry their own), and the word
// boundary still rejects `AbortControllerWrapper`.
const USE_REF_ABORT_CONTROLLER_PATTERN = /useRef\s*<[^>]*\bAbortController\b/;

// S1/S3 (review 2026-05-25): the prior `.run(` import-implies-call check
// and the "allowlist actually contains useRef<AbortController>" check
// both matched commented occurrences as if they were live code. A file
// that imported the hook with a single `.run(` reference in a JSDoc
// example silently passed the import-implies-call ban; a file whose
// only `useRef<AbortController>` was a comment from a prior refactor
// would keep the allowlist entry alive even after migration.
//
// Strips line (`// ...`) and block (`/* ... */`) comments from
// TypeScript source so the structural checks see only executable code.
// The regex pair is deliberately simple: it does not parse strings
// (so `"// hello"` is shortened to `"`, which is fine for the
// presence-checks we run downstream — we only care that real
// references survive, not that the resulting source is parseable).
// Block-comment regex is non-greedy so adjacent comments don't merge.
export function stripCommentsFromTsSource(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

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
    names.push(match[1]);
  }
  return names;
}

// Builds an import-statement regex for a named symbol. Matches a real ES
// import (start of line, possibly indented) — not a bare reference,
// comment, or string literal. Review (2026-05-24, Copilot) flagged the
// prior bare-identifier match as too lax: a future comment or string
// mention of the hook would have silently satisfied the assertion. The
// `[^}]*` segments span newlines so multi-line `import { … }` blocks
// still match.
export function importPatternFor(name: string): RegExp {
  return new RegExp(`^\\s*import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']`, "m");
}

export function collectTsSources(root: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(root)) {
    // Skip the __tests__ directory AND any co-located *.test.ts[x] file.
    // Both forms are test code, not production: the __tests__ directory
    // holds fixtures that intentionally reference `xSeqRef` in string
    // literals to prove the ESLint rule catches them, and co-located test
    // files (e.g. hooks/useAbortableSequence.test.ts) may grow similar
    // fixtures in the future. Without the filename check, adding
    // `xSeqRef` to any co-located test would false-positive this grep.
    if (entry === "__tests__") continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectTsSources(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

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

  // Phase 4b.3b post-sweep state: three files retain hand-rolled
  // useRef<AbortController> for documented second-tier-recovery
  // (HomePage.createRecoveryAbortRef; useProjectEditor's three
  // recovery refs) or simultaneously-live-controller patterns
  // (useSnapshotState.restoreFollowupAbortRef). Each retained ref
  // carries an inline justification comment at its allocation. Phase
  // 4b.4 replaces this file-level allowlist with inline
  // `// eslint-disable-next-line` on each of the surviving lines and
  // removes this `PHASE_4B_3B_ALLOWLIST` set entirely.
  //
  // Files in the allowlist are pinned by absolute-path equivalence
  // (resolved against clientSrcRoot) so the assertion stays robust
  // against rename within the tree. A file that's renamed without
  // updating this list will fail the ban — that's the intended
  // forcing function.
  const PHASE_4B_3B_ALLOWLIST = new Set([
    resolve(clientSrcRoot, "hooks/useProjectEditor.ts"),
    resolve(clientSrcRoot, "hooks/useSnapshotState.ts"),
    // EditorPage.tsx removed by Phase 4b.3b row S-1 (settingsRefreshAbortRef migrated)
    // ProjectSettingsDialog.tsx removed by Phase 4b.3b row S-10 (fieldAbortRef + timezoneAbortRef migrated)
    // SnapshotPanel.tsx removed by Phase 4b.3b row S-12 (fetchAbortRef + mutateAbortRef migrated)
    // ExportDialog.tsx removed by Phase 4b.3b row S-8 (abortRef migrated)
    resolve(clientSrcRoot, "pages/HomePage.tsx"),
  ]);

  it("no file in packages/client/src (excluding __tests__, the hook itself, and the Phase 4b.3b allowlist) contains raw useRef<AbortController>", () => {
    const HOOK_FILE = resolve(clientSrcRoot, "hooks/useAbortableAsyncOperation.ts");
    const files = collectTsSources(clientSrcRoot);
    const offenders: string[] = [];
    for (const file of files) {
      if (file === HOOK_FILE) continue;
      if (PHASE_4B_3B_ALLOWLIST.has(file)) continue;
      // S3 (review 2026-05-25): strip comments before testing so a
      // commented-out `useRef<AbortController>` reference can't keep
      // a migrated file flagged as an offender. Symmetric with the
      // allowlist "actually contains" check below.
      const source = stripCommentsFromTsSource(readFileSync(file, "utf-8"));
      if (USE_REF_ABORT_CONTROLLER_PATTERN.test(source)) {
        offenders.push(file.replace(clientSrcRoot, "packages/client/src"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Phase 4b.3b allowlist entries actually contain useRef<AbortController>", () => {
    // If an entry no longer matches, the file was either renamed (update
    // the allowlist), migrated to useAbortableAsyncOperation (remove the
    // entry), or deleted (remove the entry). All three cases are work
    // for Phase 4b.3b's per-site evaluation. Letting dead entries linger
    // would mask drift in files that still need migration.
    //
    // S3 (review 2026-05-25): the file's text must contain a LIVE
    // useRef<AbortController> — not just a commented mention of one.
    // useProjectEditor.ts in particular carries historical comments at
    // lines 97/168 that reference the prior hand-rolled pattern; a
    // future refactor migrating all live refs while leaving those
    // comments in place would silently keep the file allowlisted.
    for (const file of PHASE_4B_3B_ALLOWLIST) {
      const source = stripCommentsFromTsSource(readFileSync(file, "utf-8"));
      expect(
        source,
        `${file} is on the allowlist but no longer contains LIVE useRef<AbortController> (comments don't count)`,
      ).toMatch(USE_REF_ABORT_CONTROLLER_PATTERN);
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
        // Word-boundary on the LEFT so `xOp.run(` doesn't satisfy a
        // search for `p.run(` etc. Right-side allows an optional
        // generic argument list (`<T>`) between `.run` and `(` so
        // `saveOp.run<SaveLoopOutcome>(...)` in useProjectEditor.ts
        // matches. Inner `[^>]*` is non-nested by design — the codebase
        // uses single-level generics today; a future nested-generic
        // call would surface as an offender, forcing the regex to be
        // extended deliberately rather than silently false-passing.
        const callPattern = new RegExp(`\\b${name}\\.run\\s*(?:<[^>]*>)?\\s*\\(`);
        if (!callPattern.test(source)) {
          offenders.push({
            file: relative,
            reason: `binding "${name}" is never .run() — dead variable or drifted import`,
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

  it("useRef<AbortController> regex catches all realistic drift forms (S1)", () => {
    // Direct exercise of USE_REF_ABORT_CONTROLLER_PATTERN. If the regex is
    // ever tightened or loosened, this test pins the contract explicitly
    // rather than relying on a future drift to surface it.
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<AbortController>(null)")).toBe(true);
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<AbortController | null>(null)")).toBe(
      true,
    );
    expect(
      USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<AbortController | undefined>(undefined)"),
    ).toBe(true);
    expect(
      USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<AbortController | null | undefined>(null)"),
    ).toBe(true);
    // S5 (review 2026-05-25): multi-line generic forms. The codebase uses
    // single-line today, but a future reformat-of-long-types pass must
    // not silently break the structural check.
    expect(
      USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<\n  AbortController | null\n>(null)"),
    ).toBe(true);
    expect(
      USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<\n  AbortController\n  | null\n>(null)"),
    ).toBe(true);
    // S2 (review 2026-05-25): nested generics. Future per-key cancellation
    // patterns like `useRef<Record<string, AbortController>>` MUST match
    // — the pre-fix regex missed these (verified empirically by Copilot
    // review).
    expect(
      USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<Record<string, AbortController>>(new Map())"),
    ).toBe(true);
    expect(
      USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<Map<string, AbortController | null>>(null)"),
    ).toBe(true);
    // Negative cases — must NOT match.
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<AbortControllerWrapper>(null)")).toBe(
      false,
    );
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<MyAbortController>(null)")).toBe(false);
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<string>(null)")).toBe(false);
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
    const callPattern = new RegExp(`\\b${bindings[0]}\\.run\\s*(?:<[^>]*>)?\\s*\\(`);
    expect(callPattern.test(driftFixture)).toBe(false);

    // Positive companion: the same pattern matches a real generic-arg
    // call when the receiver IS a hook binding. saveOp.run<SaveLoopOutcome>(...)
    // in useProjectEditor.ts:385 is the live example.
    const liveFixture = `
      const saveOp = useAbortableAsyncOperation();
      const { promise: saveRunPromise } = saveOp.run<SaveLoopOutcome>(async (s) => fetch(s));
    `;
    const liveBindings = extractAbortableAsyncOperationBindings(liveFixture);
    expect(liveBindings).toEqual(["saveOp"]);
    const livePattern = new RegExp(`\\b${liveBindings[0]}\\.run\\s*(?:<[^>]*>)?\\s*\\(`);
    expect(livePattern.test(liveFixture)).toBe(true);
  });

  it("stripCommentsFromTsSource removes line and block comments (S1/S3)", () => {
    // The helper pins S1/S3 behavior: structural checks must see only
    // executable code, never commented mentions. If this contract drifts
    // (e.g. someone naively tries to strip comments with a non-greedy
    // pattern that crosses adjacent blocks), the downstream import/
    // allowlist checks would silently re-acquire the false-pass risk.
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
