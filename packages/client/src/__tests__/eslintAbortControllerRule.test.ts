import { beforeAll, describe, it, expect } from "vitest";
import { lintCode } from "./eslintRuleHarness";

// esquery+typescript-eslint init is several seconds cold; warm once.
beforeAll(async () => {
  await lintCode("export {};");
}, 30_000);

function restrictedSyntaxMessages(results: Awaited<ReturnType<typeof lintCode>>) {
  expect(results).toHaveLength(1);
  return results[0]!.messages.filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("no-restricted-syntax useRef<AbortController> rule", () => {
  it("fires on the plain useRef<AbortController> allocation", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const r = useRef<AbortController>(null);
        return r;
      }
    `;
    const msgs = restrictedSyntaxMessages(await lintCode(code));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.message).toMatch(/useAbortableAsyncOperation/);
  });

  it("fires on the `| null` union form (the shape all 6 survivors use)", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const r = useRef<AbortController | null>(null);
        return r;
      }
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(1);
  });

  it("fires on a nested generic (future per-key cancellation)", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const r = useRef<Record<string, AbortController>>(null);
        return r;
      }
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(1);
  });

  it("does NOT fire on a same-prefix wrapper type", async () => {
    const code = `
      import { useRef } from "react";
      type AbortControllerWrapper = { c: AbortController | null };
      export function x() {
        const r = useRef<AbortControllerWrapper>(null);
        return r;
      }
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(0);
  });

  it("does NOT fire on an unrelated ref type", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const r = useRef<string>(null);
        return r;
      }
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(0);
  });

  it("does NOT fire on a plain string mention (matches AST calls, not text)", async () => {
    const code = `
      export const doc = "use useRef<AbortController>(null) only with a disable";
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(0);
  });

  it("is suppressed by an inline eslint-disable on the matching line", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        // eslint-disable-next-line no-restricted-syntax -- test fixture: documented survivor
        const r = useRef<AbortController | null>(null);
        return r;
      }
    `;
    const results = await lintCode(code);
    expect(results).toHaveLength(1);
    const messages = results[0]!.messages;
    // Two precise guarantees, immune to ambient rules-of-hooks /
    // react-refresh noise on the `export function x()` wrapper (which is
    // why we do NOT assert messages.length === 0 — react-hooks/rules-of-hooks
    // fires on a hook called in a non-component/non-hook function):
    //   (a) the rule is suppressed — zero no-restricted-syntax messages
    expect(messages.filter((m) => m.ruleId === "no-restricted-syntax")).toHaveLength(0);
    //   (b) the directive is USED — no unused-disable-directive report
    //       (reportUnusedDisableDirectives defaults to "warn"; an unused
    //       directive would fail --max-warnings 0 at the real call sites).
    expect(messages.filter((m) => /unused eslint-disable/i.test(m.message))).toHaveLength(0);
  });
});
