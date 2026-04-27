import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// S3 (review 2026-04-27): the e2e isolated data dir name
// (`smudge-e2e-data` today) is duplicated between
// `playwright.config.ts` (which writes the DB) and `Makefile`'s
// `e2e-clean` target (which removes it). Drift means `make e2e-clean`
// silently no-ops on whatever `make e2e` actually wrote, with no test
// surface. Without an executable check, a maintainer renaming the dir
// in playwright.config.ts to namespace per-branch would pass
// typecheck, lint, and the full unit suite — yet `make e2e-clean`
// would still try to remove the old name. Mirror the textual parity
// pattern from `vite-config-default-port.test.ts`.
const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const PLAYWRIGHT_RE =
  /E2E_DATA_DIR\s*=\s*path\.join\(os\.tmpdir\(\),\s*"([^"]+)"\)/;
const MAKEFILE_RE =
  /require\("path"\)\.join\(require\("os"\)\.tmpdir\(\),\s*"([^"]+)"\)/;

describe("E2E_DATA_DIR parity", () => {
  it("playwright.config.ts and Makefile derive the same temp dir name", () => {
    const playwrightConfig = readFileSync(
      resolve(PROJECT_ROOT, "playwright.config.ts"),
      "utf8",
    );
    const makefileText = readFileSync(
      resolve(PROJECT_ROOT, "Makefile"),
      "utf8",
    );

    const playwrightMatch = playwrightConfig.match(PLAYWRIGHT_RE);
    const makefileMatch = makefileText.match(MAKEFILE_RE);

    expect(
      playwrightMatch,
      'E2E_DATA_DIR = path.join(os.tmpdir(), "<dir>") not found in playwright.config.ts — was the derivation rewritten? Update this test to match.',
    ).not.toBeNull();
    expect(
      makefileMatch,
      'require("path").join(require("os").tmpdir(), "<dir>") not found in Makefile — was the e2e-clean derivation rewritten? Update this test to match.',
    ).not.toBeNull();
    expect(playwrightMatch![1]).toBe(makefileMatch![1]);
  });
});
