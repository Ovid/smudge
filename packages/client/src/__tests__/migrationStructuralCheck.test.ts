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

  // 4b.3a.4 collapsed the per-file `migrated` array into a global walk
  // because ImageGallery was the last consumer in this hook's
  // dedicated migration cluster (4b.3a.2/3/4). Seven files with
  // hand-rolled `useRef<AbortController>` allocations remain pending
  // Phase 4b.3b's per-site evaluation; several of those files contain
  // multiple allocations (e.g. useProjectEditor.ts), so "seven" counts
  // allowlisted files, not call sites. See PHASE_4B_3B_ALLOWLIST below
  // and Phase 4b.3a.1 §Out of Scope in docs/roadmap.md (which also
  // lists App.tsx and DashboardView.tsx — those use AbortController
  // without useRef, so they don't match this regex and aren't
  // allowlisted here). Phase 4b.3b decides per-site whether each site
  // adopts useAbortableAsyncOperation or stays hand-rolled with
  // justification; a file leaves PHASE_4B_3B_ALLOWLIST once all of its
  // useRef<AbortController> allocations have been adopted or removed,
  // and Phase 4b.4 collapses the allowlist to nothing once it empties.
  //
  // Files in the allowlist are pinned by absolute-path equivalence
  // (resolved against clientSrcRoot) so the assertion stays robust
  // against rename within the tree. A file that's renamed without
  // updating this list will fail the ban — that's the intended
  // forcing function.
  const PHASE_4B_3B_ALLOWLIST = new Set([
    resolve(clientSrcRoot, "components/ExportDialog.tsx"),
    resolve(clientSrcRoot, "hooks/useProjectEditor.ts"),
    resolve(clientSrcRoot, "hooks/useSnapshotState.ts"),
    // EditorPage.tsx removed by Phase 4b.3b row S-1 (settingsRefreshAbortRef migrated)
    // ProjectSettingsDialog.tsx removed by Phase 4b.3b row S-10 (fieldAbortRef + timezoneAbortRef migrated)
    // SnapshotPanel.tsx removed by Phase 4b.3b row S-12 (fetchAbortRef + mutateAbortRef migrated)
    resolve(clientSrcRoot, "pages/HomePage.tsx"),
  ]);

  it("no file in packages/client/src (excluding __tests__, the hook itself, and the Phase 4b.3b allowlist) contains raw useRef<AbortController>", () => {
    const HOOK_FILE = resolve(clientSrcRoot, "hooks/useAbortableAsyncOperation.ts");
    const files = collectTsSources(clientSrcRoot);
    const offenders: string[] = [];
    for (const file of files) {
      if (file === HOOK_FILE) continue;
      if (PHASE_4B_3B_ALLOWLIST.has(file)) continue;
      const source = readFileSync(file, "utf-8");
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
    for (const file of PHASE_4B_3B_ALLOWLIST) {
      const source = readFileSync(file, "utf-8");
      expect(
        source,
        `${file} is on the allowlist but no longer contains useRef<AbortController>`,
      ).toMatch(USE_REF_ABORT_CONTROLLER_PATTERN);
    }
  });

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
    // Negative cases — must NOT match.
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<AbortControllerWrapper>(null)")).toBe(
      false,
    );
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<MyAbortController>(null)")).toBe(false);
    expect(USE_REF_ABORT_CONTROLLER_PATTERN.test("useRef<string>(null)")).toBe(false);
  });
});
