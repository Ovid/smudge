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
