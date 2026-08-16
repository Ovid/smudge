import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { validateUuidParam } from "../validateUuidParam";
import { UUID_PATTERN } from "../images/images.paths";

// I4 (review 2026-08-16). `validateUuidParam` is a trust boundary, and its
// accepted domain moved without a test noticing: declaring `zod: ^3.24.3` in
// packages/server/package.json changed which copy `import { z } from "zod"`
// resolves to (root zod 4.x, hoisted by a plugin, → packages/server's own
// zod 3.x), and zod 3's `.uuid()` is a pure hex-shape check where zod 4's also
// enforces the version and variant nibbles. Every existing routes test used
// "not-a-uuid", which both versions reject, so nothing went red.
//
// This file pins the domain in both directions AND pins the one claim the
// file's own doc comment used to get wrong: that this helper and the images
// module's `UUID_PATTERN` accept DIFFERENT sets. They do not — which is why the
// stated reason for keeping two parallel UUID validators no longer holds.

const asReq = (id: string) => ({ params: { id } }) as unknown as Request;
const uuidPatternMatches = (id: string) => new RegExp(`^${UUID_PATTERN}$`, "i").test(id);

// Version nibble 4 / variant nibble 8 — a real v4 UUID, accepted everywhere.
const CANONICAL = "9f8e7d6c-5b4a-4392-8b1c-2d3e4f5a6b7c";

const ACCEPTED = [
  ["canonical v4", CANONICAL],
  // The two that zod 4 rejected and zod 3 does not. Listed explicitly so a
  // future zod upgrade that re-tightens the domain fails HERE, at the
  // documented contract, rather than as a puzzling 400 in someone's browser.
  ["version nibble not 4", "9f8e7d6c-5b4a-9392-8b1c-2d3e4f5a6b7c"],
  ["variant nibble not 8/9/a/b", "9f8e7d6c-5b4a-4392-cb1c-2d3e4f5a6b7c"],
  ["uppercase hex", CANONICAL.toUpperCase()],
] as const;

const REJECTED = [
  ["obvious garbage", "not-a-uuid"],
  ["no hyphens", CANONICAL.replaceAll("-", "")],
  ["non-hex character", "9f8e7d6c-5b4a-4392-8b1c-2d3e4f5a6b7g"],
  ["one nibble short", CANONICAL.slice(0, -1)],
  ["empty", ""],
] as const;

describe("validateUuidParam accepted domain", () => {
  it.each(ACCEPTED)("accepts %s", (_label, id) => {
    expect(validateUuidParam(asReq(id))).toBe(id);
  });

  it.each(REJECTED)("rejects %s with a 400", (_label, id) => {
    expect(() => validateUuidParam(asReq(id), "chapter")).toThrowError(/Invalid chapter id/);
  });
});

describe("validateUuidParam and images' UUID_PATTERN accept the same domain", () => {
  // The images holdout stays (its `router.use()` form is structurally stronger
  // than the per-handler form), but NOT because the two accept different sets.
  // If a change makes them diverge, that is a real decision to make explicitly.
  it.each([...ACCEPTED, ...REJECTED])("agree on %s", (_label, id) => {
    let helperAccepts = true;
    try {
      validateUuidParam(asReq(id));
    } catch {
      helperAccepts = false;
    }
    expect(uuidPatternMatches(id)).toBe(helperAccepts);
  });
});
