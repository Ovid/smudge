import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Shared source-tree scanning helpers for the structural drift-detector tests
// (migrationStructuralCheck.test.ts, mutationCommittedSurface.test.ts). They
// live in a plain module rather than in either test file because importing a
// *.test.ts from another test file re-registers its describe blocks in the
// importer's suite. Review I2 (2026-08-19) asked the second file to reuse the
// first's comment stripper instead of re-deriving a weaker one; this module is
// where the reuse lands.

// S1/S3 (review 2026-05-25): the prior `.run(` import-implies-call check
// matched commented occurrences as if they were live code. A file
// that imported the hook with a single `.run(` reference in a JSDoc
// example silently passed the import-implies-call ban.
//
// Strips line (`// ...`) and block (`/* ... */`) comments from TypeScript
// source so the structural checks see only executable code.
//
// S6 (review 2026-08-19): string literals are now recognised and passed
// through verbatim. This function moved out of migrationStructuralCheck.test.ts,
// where every consumer was a PRESENCE check and a little over-stripping was
// harmless; mutationCommittedSurface.test.ts derives equality-of-COUNTS
// decisions from the output, where over-stripping flips a numeric assertion and
// a swallowed handle binding silently removes a file from caller discovery.
// The concrete latent failure was a glob literal — `"**/*.ts"` opened a block
// comment that ran to the next `*/` anywhere below it.
//
// S3 (review round 3, 2026-08-19): REGEX literals are recognised and passed
// through too. They used to be read as opening a string, and the ceiling
// recorded here claimed the worst case was "a real comment left unstripped —
// a false RED, not a silent green". That was wrong in its load-bearing half.
// The fake string runs to the NEXT quote and the scanner resumes
// mid-expression, where a `/*` inside a glob literal opens a block comment
// running to the next real `*/` anywhere below — DELETING every line between.
// Counts go DOWN, so a file drops silently out of mutationCommittedSurface's
// caller discovery. Verified with `const re = /"/;` above `glob("**/*.ts")`.
//
// The regex branch is deliberately preceded by a lookbehind restricting it to
// positions where a regex may legally begin, so division (`a / b`) is not
// mistaken for one. A mis-detection is benign anyway — it passes the span
// through verbatim, the same thing the string branch does — with one residual:
// a real comment INSIDE a mis-detected span survives, a false RED. Full
// tokenizer remains the upgrade path.
//
// Block-comment regex stays non-greedy so adjacent comments don't merge.
export function stripCommentsFromTsSource(source: string): string {
  return source.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|(?<=[=(,:[!&|?{};]\s*)\/(?![*\/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\/\\\n])+\/[dgimsuvy]*)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (_match, literal: string | undefined) => literal ?? "",
  );
}

// S4 (review 2026-08-19): the `<binding>.run(` matcher used to be written out
// twice — once in migrationStructuralCheck.test.ts and once in
// mutationCommittedSurface.test.ts — and the two copies had drifted apart, so
// the same source text got different answers from two detectors scanning the
// same tree for the same construct. This is the single owner of the shape.
//
// Tolerated: an optional generic argument list (including a NESTED one — the
// lazy `<.*?>` is what the earlier `<[^>]*>` got wrong, stopping at the inner
// `>`), optional chaining (`op?.run(`), and a Prettier line wrap between the
// receiver and `.run`, and one `.current` hop for a ref-held binding. Not
// tolerated, deliberately: a destructured
// `const { run } = op`, which each caller must detect and reject on its own
// terms — see mutationCommittedSurface.test.ts, where it is an offender.
export function runCallPattern(name: string, flags = ""): RegExp {
  return new RegExp(
    `\\b${name}(?:\\s*\\??\\.\\s*current)?\\s*\\??\\.\\s*run\\s*(?:<.*?>)?\\s*\\(`,
    flags,
  );
}

// The "binding passed as an argument to a known delegating helper" matcher.
//
// S2 (review round 3, 2026-08-19): this shape was written out twice in
// migrationStructuralCheck.test.ts — once in the production check and once in
// the fixture test meant to pin it — so the test could keep passing while the
// production copy drifted. Single owner, same treatment `runCallPattern` got.
//
// Ceiling, deliberately: `[^)]*` cannot span a nested-paren argument list, so
// `refreshTrashList(getProject(), projectRef, trashOp)` would not be recognised
// as consuming `trashOp` and would surface a false-positive "dead binding"
// offender. That is a false RED demanding a decision, not a silent pass. Today
// the only delegation site is `refreshTrashList(project, projectRef, slugRef,
// trashOp)`. When one needs nested parens, extend this with a paren-counting
// walker rather than tweaking the regex.
export function delegationPattern(helper: string, name: string): RegExp {
  return new RegExp(`\\b${helper}\\s*\\([^)]*\\b${name}\\b[^)]*\\)`);
}

// Builds an import-statement regex for a named symbol. Matches a real ES
// import (start of line, possibly indented) — not a bare reference, comment,
// or string literal. Review (2026-05-24, Copilot) flagged the prior
// bare-identifier match as too lax: a future comment or string mention of the
// hook would have silently satisfied the assertion. The `[^}]*` segments span
// newlines so multi-line `import { … }` blocks still match.
//
// I1 (review 2026-08-19): `import type { … }` matches too. It did not before,
// and useSnapshotController.ts / useFindReplaceController.ts both reach
// useEditorMutation exactly that way — a type-only import gate that missed
// them would have gated nothing.
export function importPatternFor(name: string): RegExp {
  return new RegExp(
    `^\\s*import\\s*(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']`,
    "m",
  );
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
