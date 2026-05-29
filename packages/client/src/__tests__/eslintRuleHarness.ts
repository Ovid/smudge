import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Monorepo root = four levels up (packages/client/src/__tests__/ → repo
// root). The flat-config `packages/client/**/*.{ts,tsx}` pattern is matched
// relative to the ESLint cwd, so cwd must be the repo root for the block to
// apply regardless of whether the test runs from the repo root (`make test`)
// or the workspace (`npm test -w packages/client`).
export const REPO_ROOT = resolve(__dirname, "../../../..");

// Fixtures must live under packages/client/src/ so the client config block
// matches. Use the .tsx path for rules that need JSX parsing.
export const FIXTURE_PATH = resolve(REPO_ROOT, "packages/client/src/fixture.ts");
export const FIXTURE_PATH_TSX = resolve(REPO_ROOT, "packages/client/src/fixture.tsx");

// ESLint's flat-config load + TS parser init is several seconds cold. Share
// one instance across a suite and warm it in beforeAll.
let linter: ESLint | null = null;
export function createLinter(): ESLint {
  linter ??= new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: resolve(REPO_ROOT, "eslint.config.js"),
  });
  return linter;
}

export async function lintCode(
  code: string,
  filePath: string = FIXTURE_PATH,
): Promise<ESLint.LintResult[]> {
  return createLinter().lintText(code, { filePath });
}
