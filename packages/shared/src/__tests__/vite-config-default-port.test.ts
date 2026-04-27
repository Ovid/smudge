import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { DEFAULT_SERVER_PORT } from "../constants";

// I2 (review 2026-04-26 039ca1b): DEFAULT_SERVER_PORT (number, here)
// and DEFAULT_SERVER_PORT_VITE (string, in packages/client/vite.config.ts)
// are two parallel literals for the same concept in different
// packages, with comment-only "must equal" coupling. The vite-side
// comment acknowledges drift "is invisible at runtime"; without an
// executable check, a maintainer who edits DEFAULT_SERVER_PORT to
// 4000 in this package would pass typecheck, lint, and the full unit
// suite — yet the dev workflow's client→server proxy would silently
// keep targeting localhost:3456 while the server bound 4000. Symptom:
// 502 on every /api call in dev, far from the cause.
//
// vite.config.ts cannot import @smudge/shared (vite's config resolver
// runs under bare Node ESM, which cannot resolve the extensionless
// re-exports inside src/index.ts — see packages/client/vite.config.ts:25-30
// for the verbatim ERR_MODULE_NOT_FOUND), so a textual parity check is the
// next-best guarantee that the two literals stay in lockstep.
const VITE_CONFIG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../client/vite.config.ts",
);

describe("DEFAULT_SERVER_PORT_VITE parity", () => {
  it("matches String(DEFAULT_SERVER_PORT) in packages/client/vite.config.ts", () => {
    const viteConfigSource = readFileSync(VITE_CONFIG_PATH, "utf8");
    const match = viteConfigSource.match(/DEFAULT_SERVER_PORT_VITE\s*=\s*"(\d+)"/);
    expect(
      match,
      'DEFAULT_SERVER_PORT_VITE = "<digits>" literal not found in vite.config.ts — was the constant renamed or deleted? Update this test to match.',
    ).not.toBeNull();
    expect(match![1]).toBe(String(DEFAULT_SERVER_PORT));
  });
});
