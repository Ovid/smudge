import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

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
// I2 (review round 4, 2026-08-19): this was a hand-written regex, patched in
// three consecutive review rounds — for strings (round 2, S6), then regex
// literals (round 3, S3), and it was still deleting executable code in two
// common positions. Its regex-literal lookbehind class held no `>` and no
// keyword, so `=> /…/` and `return /…/` never entered the regex branch and
// fell through to the string alternative, which has no newline exclusion and
// runs to the next quote anywhere below. Counts go DOWN, which is the
// silent-green direction: a file drops out of mutationCommittedSurface's
// caller discovery and the F-07 forcing pause ships green on an unguarded
// caller. Rather than a fourth hand-patch, the job is now done by the
// TypeScript parser that already ships as a root devDependency. Both
// consumers are Node-side test files, so the cost is test-time only.
//
// Why the parser and not `ts.createScanner`: whether `/` opens a regex
// literal or is a division operator is a PARSER decision (the scanner exposes
// `reScanSlashToken` for exactly this reason), so a bare token loop
// reintroduces the round-3 bug. Parsing first and then removing the comment
// ranges TypeScript itself reports gets regex literals, nested template
// substitutions, and JSX text right by construction — the last of which the
// regex never handled at all.
//
// Comments reachable two ways: a comment preceded by a newline is LEADING
// trivia of the following token, and a same-line comment is TRAILING trivia of
// the preceding one. Both are collected, keyed by start position so the
// overlap between the two views dedupes.
export function stripCommentsFromTsSource(source: string): string {
  const sourceFile = ts.createSourceFile(
    "scan.tsx",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const comments = new Map<number, number>();
  const visit = (node: ts.Node): void => {
    for (const r of ts.getLeadingCommentRanges(source, node.pos) ?? []) comments.set(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(source, node.end) ?? []) comments.set(r.pos, r.end);
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);

  let out = "";
  let cursor = 0;
  for (const [pos, end] of [...comments.entries()].sort((a, b) => a[0] - b[0])) {
    if (pos < cursor) continue;
    out += source.slice(cursor, pos);
    cursor = end;
  }
  return out + source.slice(cursor);
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
