import { describe, it, expect, afterEach } from "vitest";
import { ESLint } from "eslint";
import { writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// F-09. `import/no-cycle` has one failure mode that matters: it reports
// NOTHING when its resolution or parsing prerequisites are missing, which is
// indistinguishable from a clean bill of health. That is not hypothetical —
// before this rule was enabled, an ad-hoc probe reported "0 cycles" across the
// whole tree purely because the plugin could not resolve extensionless
// relative TypeScript imports. Two eslint.config.js `settings` entries are
// required, and each fails silently on its own:
//   - `import/resolver: { typescript: true }` — without it the plugin cannot
//     resolve `./sibling` from a .ts file, so the cycle walk never starts.
//   - `import/parsers: { "@typescript-eslint/parser": [".ts", ".tsx"] }` —
//     without it resolution succeeds but the plugin cannot parse the IMPORTED
//     .ts file to read its imports, so a real cycle is still missed.
// This test plants an actual two-file cycle on disk and requires it to be
// reported. It is the forcing pause: if either setting is dropped, or the
// resolver dependency is removed, this goes red instead of going quiet.
//
// Real files (not `lintText` like the sibling rule tests) because cycle
// detection has to traverse the import graph across the filesystem.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const SRC = resolve(REPO_ROOT, "packages/client/src");

// Distinctive prefix so a stray file from an interrupted run is obvious and
// greppable, and cannot collide with real modules.
const A = resolve(SRC, "__cycle_fixture_a.ts");
const B = resolve(SRC, "__cycle_fixture_b.ts");
const ACYCLIC = resolve(SRC, "__cycle_fixture_acyclic.ts");

async function cleanup() {
  await Promise.all([A, B, ACYCLIC].map((f) => rm(f, { force: true })));
}
afterEach(cleanup);

async function cycleMessagesFor(file: string) {
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: resolve(REPO_ROOT, "eslint.config.js"),
  });
  const results = await eslint.lintFiles([file]);
  return results.flatMap((r) => r.messages).filter((m) => m.ruleId === "import/no-cycle");
}

describe("import/no-cycle is actually wired up (not silently no-opping)", () => {
  it("reports a planted two-file TypeScript cycle", async () => {
    await writeFile(A, 'import { b } from "./__cycle_fixture_b";\nexport const a = () => b();\n');
    await writeFile(B, 'import { a } from "./__cycle_fixture_a";\nexport const b = () => a();\n');

    const msgs = await cycleMessagesFor(A);

    // The assertion that matters: a real cycle must produce a real error.
    // An empty array here means the rule has gone quiet, which is exactly the
    // false-green this test exists to prevent.
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.message).toMatch(/cycle/i);
  }, 60_000);

  it("stays silent on an acyclic import of the same shape", async () => {
    // Guards the other direction: the rule must not simply flag every
    // relative import, which would make the test above pass for free.
    await writeFile(B, "export const b = () => 1;\n");
    await writeFile(
      ACYCLIC,
      'import { b } from "./__cycle_fixture_b";\nexport const c = () => b();\n',
    );

    expect(await cycleMessagesFor(ACYCLIC)).toHaveLength(0);
  }, 60_000);
});
