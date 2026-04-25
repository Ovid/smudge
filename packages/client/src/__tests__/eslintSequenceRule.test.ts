import { beforeAll, describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Monorepo root = four levels up from this test file
// (packages/client/src/__tests__/ → repo root). The flat-config
// `files: ["packages/client/**/*.{ts,tsx}"]` pattern is matched relative
// to the ESLint cwd, so pinning cwd to the repo root is required for the
// pattern to hit regardless of whether the test was invoked from the
// repo root (`make test`) or the workspace directory (`npm test -w
// packages/client`). Without this cwd the rule silently no-ops in the
// workspace-scoped invocation and the test sees 0 messages.
const REPO_ROOT = resolve(__dirname, "../../../..");

// ESLint's flat-config load + TypeScript parser init is several seconds on a
// cold run. Share one instance and warm it in beforeAll so the 5s per-test
// default covers actual linting, not first-call init.
let linter: ESLint | null = null;
function getLinter(): ESLint {
  linter ??= new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: resolve(REPO_ROOT, "eslint.config.js"),
  });
  return linter;
}

async function lint(code: string): Promise<ESLint.LintResult[]> {
  return getLinter().lintText(code, {
    filePath: resolve(REPO_ROOT, "packages/client/src/fixture.ts"),
  });
}

beforeAll(async () => {
  await lint("export {};");
}, 30_000);

describe("no-restricted-syntax sequence-ref rule", () => {
  it("rejects `seq !== xSeqRef.current` — the classic staleness pattern", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const ref = useRef(0);
        const seq = ++ref.current;
        if (seq !== ref.current) return;
      }
    `;
    const results = await lint(code);
    expect(results).toHaveLength(1);
    const result = results[0]!;
    const msgs = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.message).toMatch(/useAbortableSequence/);
  });

  it("rejects `seq === xSeqRef.current` — the still-fresh negative check", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const ref = useRef(0);
        const seq = ref.current;
        if (seq === ref.current) return;
      }
    `;
    const results = await lint(code);
    expect(results).toHaveLength(1);
    const result = results[0]!;
    const msgs = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(msgs).toHaveLength(1);
  });

  it("allows `activeChapterRef.current?.id === savingChapterId` — MemberExpression on the LEFT", async () => {
    const code = `
      import { useRef } from "react";
      export function x(savingChapterId: string) {
        const ref = useRef<{ id: string } | null>(null);
        if (ref.current?.id === savingChapterId) return;
      }
    `;
    const results = await lint(code);
    expect(results).toHaveLength(1);
    const result = results[0]!;
    const msgs = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(msgs).toHaveLength(0);
  });

  it("does NOT reject the mirrored form `ref.current !== seq` — by design (S1)", async () => {
    // Pins the rejection rationale for code review S1 (2026-04-22). Adding a
    // `[left.property.name='current'][right.type='Identifier']` selector to
    // catch the mirrored form looks attractive ("close the bypass"), but
    // false-positives on 14 legitimate sites across the client package:
    //   - prev-value diff detection: `prevSlugArgRef.current !== slug`
    //   - abort-controller identity: `saveAbortRef.current === controller`
    //   - slug-drift check: `projectSlugRef.current !== slug && ...`
    //   - still-on-chapter: `currentChapterIdRef.current === restoringChapterId`
    //   - the canonical epoch check inside useAbortableSequence itself
    // esquery cannot express the cross-statement constraint that actually
    // distinguishes the anti-pattern (a `++ref.current` bump paired with a
    // staleness check). The primary defense is the useAbortableSequence
    // primitive; the original-form rule is a backstop for the simplest
    // bypass, not a complete fence. This test makes that design choice
    // explicit — if someone re-evaluates and wants to tighten the selector,
    // they must consciously update this test first.
    const code = `
      import { useRef } from "react";
      export function x() {
        const ref = useRef(0);
        const seq = ++ref.current;
        if (ref.current !== seq) return;
      }
    `;
    const results = await lint(code);
    expect(results).toHaveLength(1);
    const result = results[0]!;
    const msgs = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(msgs).toHaveLength(0);
  });
});
