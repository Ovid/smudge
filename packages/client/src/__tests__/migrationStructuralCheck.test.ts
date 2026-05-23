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
const USE_REF_ABORT_CONTROLLER_PATTERN = /useRef\s*<\s*AbortController\b[^>]*>/;

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
    for (const file of migrated) {
      const source = readFileSync(file, "utf-8");
      expect(source, `${file} should import useAbortableSequence`).toMatch(/useAbortableSequence/);
    }
  });

  it("useAbortableAsyncOperation is imported by every file that has been migrated to it", () => {
    // Phase 4b.3a.2 (find-replace) is the first migration of this hook;
    // 4b.3a.3 (useTrashManager) and 4b.3a.4 (ImageGallery) will append
    // their migrated files to this list. Whichever phase lands last can
    // collapse this per-file check into a global ban.
    const migrated = [resolve(clientSrcRoot, "hooks/useFindReplaceState.ts")];
    for (const file of migrated) {
      const source = readFileSync(file, "utf-8");
      expect(source, `${file} should import useAbortableAsyncOperation`).toMatch(
        /useAbortableAsyncOperation/,
      );
    }
  });

  it("migrated files do not contain raw useRef<AbortController>", () => {
    // Companion to the import assertion above; whichever migration phase
    // lands last can convert this from a per-file check to a global
    // packages/client/src ban (excluding the hook file itself).
    //
    // The regex covers `useRef<AbortController>` and any single-line
    // union that ends with `>` (`| null`, `| undefined`, `| null |
    // undefined`, etc). The `\b[^>]*>` tail is what catches drift —
    // S1 (review 2026-05-01) flagged the prior `(?:\|\s*null\s*)?>` as
    // missing the `| undefined` variant. The word-boundary on
    // `AbortController\b` keeps false positives like
    // `useRef<AbortControllerWrapper>` out.
    const migrated = [resolve(clientSrcRoot, "hooks/useFindReplaceState.ts")];
    for (const file of migrated) {
      const source = readFileSync(file, "utf-8");
      expect(source, `${file} should not contain useRef<AbortController>`).not.toMatch(
        USE_REF_ABORT_CONTROLLER_PATTERN,
      );
    }
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
    // Negative cases — must NOT match.
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<AbortControllerWrapper>(null)")).toBe(
      false,
    );
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<MyAbortController>(null)")).toBe(false);
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<string>(null)")).toBe(false);
  });
});
