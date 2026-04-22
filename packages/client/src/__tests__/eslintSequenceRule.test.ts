import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function lint(code: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({
    overrideConfigFile: resolve(__dirname, "../../../../eslint.config.js"),
  });
  return eslint.lintText(code, { filePath: resolve(__dirname, "fixture.ts") });
}

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
    const [result] = await lint(code);
    const msgs = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].message).toMatch(/useAbortableSequence/);
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
    const [result] = await lint(code);
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
    const [result] = await lint(code);
    const msgs = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(msgs).toHaveLength(0);
  });
});
