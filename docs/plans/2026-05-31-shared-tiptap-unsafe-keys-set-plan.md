# Shared TipTap Unsafe-Keys Set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two byte-identical prototype-pollution strip-sets (`CANONICAL_UNSAFE_KEYS` in `tiptap-text.ts`, `UNSAFE_KEYS` in `content-hash.ts`) with a single shared `CANONICAL_UNSAFE_KEYS` exported from `packages/shared/`, homed in a renamed `tiptap-safety.ts` module.

**Architecture:** The existing zero-dependency `packages/shared/src/tiptap-depth.ts` (which already holds the two adversarial-input guards `MAX_TIPTAP_DEPTH` and `validateTipTapDepth`) is renamed to `tiptap-safety.ts` and gains a third member, `CANONICAL_UNSAFE_KEYS: ReadonlySet<string>`. Both canonicalization paths import it; their local copies are deleted. Behavior is unchanged — the consolidation is enforced at compile time by the shared symbol, and a new behavioral test locks the (previously untested) strip behavior.

**Tech Stack:** TypeScript, npm workspaces, Vitest. `@smudge/shared` resolves to source (`src/index.ts`) via the workspace symlink, so no build step is needed for the constant to reach the server package.

**Design doc:** `docs/plans/2026-05-31-shared-tiptap-unsafe-keys-set-design.md`
**Roadmap phase:** 4b.10

---

## Repository constraints (from CLAUDE.md)

- **Coverage floors** (enforced in `vitest.config.ts`): 95% statements, 85% branches, 90% functions, 95% lines. This change adds a covered constant + a behavioral test; it does not reduce coverage.
- **Zero warnings in test output.** The new behavioral test is a valid-JSON happy path — it emits no `logger.warn`/`debug`, so it needs no spy. (The `expectConsole()` rule applies only to the **client** suite; the server `content-hash.test.ts` legitimately spies on `logger`, not `console`.)
- **One-feature / phase-boundary rule.** This plan is a single refactor for a single roadmap phase (4b.10). No second feature or unrelated fix is bundled.
- **No `.devcontainer/` changes.**

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/shared/src/tiptap-depth.ts` → `packages/shared/src/tiptap-safety.ts` | Rename + extend | Zero-dependency TipTap structural-safety limits: depth cap, depth validator, **and** the unsafe-key strip-set. |
| `packages/shared/src/index.ts` | Modify | Add a **direct** barrel export of `CANONICAL_UNSAFE_KEYS` from `./tiptap-safety`. |
| `packages/shared/src/schemas.ts` | Modify | Update internal import path `./tiptap-depth` → `./tiptap-safety`. |
| `packages/shared/src/wordcount.ts` | Modify | Update internal import path `./tiptap-depth` → `./tiptap-safety`. |
| `packages/shared/src/tiptap-text.ts` | Modify | Update import path; import shared constant; delete local `CANONICAL_UNSAFE_KEYS`. |
| `packages/server/src/snapshots/content-hash.ts` | Modify | Import shared constant; delete local `UNSAFE_KEYS`; update its one use. |
| `packages/shared/src/__tests__/tiptap-safety.test.ts` | Create | Minimal export-wiring/contract test for the barrel export. |
| `packages/server/src/__tests__/content-hash.test.ts` | Modify | Add behavioral test: `canonicalContentHash` strips unsafe keys. |

> **Note on `packages/shared/dist/`:** gitignored build leftover, not consumed (the package `exports` map points at `src`), and excluded from typecheck (`tsconfig` `include: ["src"]`). Ignore it; do not edit or commit it.

---

## Task 1: Rename the safety module and fix internal import paths

Pure mechanical refactor. The existing test suite is the safety net — no new test here. External consumers reach `MAX_TIPTAP_DEPTH`/`validateTipTapDepth` through the `@smudge/shared` barrel, so only three internal relative importers change.

**Files:**
- Rename: `packages/shared/src/tiptap-depth.ts` → `packages/shared/src/tiptap-safety.ts`
- Modify: `packages/shared/src/schemas.ts:2`
- Modify: `packages/shared/src/tiptap-text.ts:11`
- Modify: `packages/shared/src/wordcount.ts:4`

- [ ] **Step 1: Rename the file with git**

```bash
git mv packages/shared/src/tiptap-depth.ts packages/shared/src/tiptap-safety.ts
```

- [ ] **Step 2: Update the import path in `schemas.ts`**

In `packages/shared/src/schemas.ts`, change line 2 from:

```ts
import { MAX_TIPTAP_DEPTH, validateTipTapDepth } from "./tiptap-depth";
```

to:

```ts
import { MAX_TIPTAP_DEPTH, validateTipTapDepth } from "./tiptap-safety";
```

(The re-export on line 6, `export { MAX_TIPTAP_DEPTH, validateTipTapDepth };`, references the imported bindings, not the path — leave it unchanged.)

- [ ] **Step 3: Update the import path in `tiptap-text.ts`**

In `packages/shared/src/tiptap-text.ts`, change line 11 from:

```ts
import { MAX_TIPTAP_DEPTH as MAX_WALK_DEPTH } from "./tiptap-depth";
```

to:

```ts
import { MAX_TIPTAP_DEPTH as MAX_WALK_DEPTH } from "./tiptap-safety";
```

- [ ] **Step 4: Update the import path in `wordcount.ts`**

In `packages/shared/src/wordcount.ts`, change line 4 from:

```ts
import { MAX_TIPTAP_DEPTH } from "./tiptap-depth";
```

to:

```ts
import { MAX_TIPTAP_DEPTH } from "./tiptap-safety";
```

- [ ] **Step 5: Run the shared + server suites to verify the rename is clean**

Run: `npm test -w packages/shared && npm test -w packages/server`
Expected: PASS (all existing tests green; the rename is purely a path change).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tiptap-safety.ts packages/shared/src/schemas.ts packages/shared/src/tiptap-text.ts packages/shared/src/wordcount.ts
git commit -m "refactor(4b.10): rename tiptap-depth module to tiptap-safety

Broaden the zero-dependency safety module's name ahead of adding the
shared unsafe-key set. Internal-only: the three relative importers
(schemas, tiptap-text, wordcount) are updated; barrel consumers are
untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add the shared `CANONICAL_UNSAFE_KEYS` constant + barrel export

TDD: the failing wiring test comes first (genuine RED — the constant is not yet exported).

**Files:**
- Test: `packages/shared/src/__tests__/tiptap-safety.test.ts` (create)
- Modify: `packages/shared/src/tiptap-safety.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing wiring test**

Create `packages/shared/src/__tests__/tiptap-safety.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CANONICAL_UNSAFE_KEYS } from "../index";

describe("CANONICAL_UNSAFE_KEYS", () => {
  it("is exported from the package barrel with exactly the three prototype-pollution keys", () => {
    expect(CANONICAL_UNSAFE_KEYS.has("__proto__")).toBe(true);
    expect(CANONICAL_UNSAFE_KEYS.has("prototype")).toBe(true);
    expect(CANONICAL_UNSAFE_KEYS.has("constructor")).toBe(true);
    expect(CANONICAL_UNSAFE_KEYS.size).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w packages/shared -- tiptap-safety`
Expected: FAIL — `CANONICAL_UNSAFE_KEYS` is not exported (TypeScript/import error or undefined).

- [ ] **Step 3: Broaden the module header comment**

In `packages/shared/src/tiptap-safety.ts`, replace the opening doc-comment's first sentence so the module name matches its contents. Change:

```ts
/**
 * Zero-dependency module holding the TipTap depth cap and its structural
 * validator. Broken out of schemas.ts so client-side modules that only
```

to:

```ts
/**
 * Zero-dependency module holding TipTap structural-safety limits: the
 * depth cap, its structural validator, and the prototype-pollution
 * unsafe-key set. Broken out of schemas.ts so client-side modules that only
```

(Leave the rest of the comment — the tree-shaking rationale — unchanged.)

- [ ] **Step 4: Append the shared constant to the module**

At the **end** of `packages/shared/src/tiptap-safety.ts`, append:

```ts

/**
 * Keys that would mutate an object's prototype chain when assigned via
 * bracket access. TipTapDocSchema uses .passthrough(), so content read from
 * the DB can legitimately carry any key — the canonicalization paths strip
 * these so a crafted `{"__proto__": {...}}` attrs value cannot poison the
 * result. Hashing/comparison proceeds with the key absent.
 *
 * Shared by tiptap-text.ts (canonicalJSON / marks comparison) and
 * content-hash.ts (canonicalize / snapshot hashing) so the two defenses
 * cannot drift apart. Typed ReadonlySet so neither consumer can mutate the
 * single shared instance out from under the other.
 */
export const CANONICAL_UNSAFE_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);
```

- [ ] **Step 5: Add the direct barrel export**

In `packages/shared/src/index.ts`, add this line in the export region (e.g. immediately after the `export { ... } from "./tiptap-text";` block, keeping related TipTap exports together):

```ts
export { CANONICAL_UNSAFE_KEYS } from "./tiptap-safety";
```

Do **not** route it through `./schemas` — `schemas.ts` does not consume this constant, and routing it there would couple the zero-dependency constant to the Zod module's re-export surface.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -w packages/shared -- tiptap-safety`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/tiptap-safety.ts packages/shared/src/index.ts packages/shared/src/__tests__/tiptap-safety.test.ts
git commit -m "feat(4b.10): add shared CANONICAL_UNSAFE_KEYS + barrel export

Single ReadonlySet declaration of the __proto__/prototype/constructor
strip-set in tiptap-safety.ts, exported directly from the package
barrel. Consumers migrate in the following commits.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Behavioral strip test + migrate `content-hash.ts`

The behavioral test characterizes the prototype-pollution defense (untested until now) and guards the migration: it passes on current code and must stay green after the local set is replaced by the shared import.

**Files:**
- Modify: `packages/server/src/__tests__/content-hash.test.ts`
- Modify: `packages/server/src/snapshots/content-hash.ts`

- [ ] **Step 1: Add the behavioral test**

In `packages/server/src/__tests__/content-hash.test.ts`, insert this `it(...)` block inside the `describe("canonicalContentHash", ...)` block, immediately before its closing `});` (after the existing "differs when content differs" test is fine):

```ts
  it("strips prototype-pollution keys so they cannot poison the canonical hash", () => {
    // Build inputs as raw JSON strings, NOT object literals: in a JS object
    // literal `{ __proto__: ... }` sets the prototype instead of creating an
    // own "__proto__" property, so a literal would never exercise the strip.
    // JSON.parse, by contrast, creates an own enumerable "__proto__" property —
    // exactly the adversarial shape canonicalize() must neutralize.
    const withUnsafe =
      '{"type":"doc","content":[{"type":"paragraph","attrs":' +
      '{"__proto__":{"polluted":true},"prototype":1,"constructor":"x","color":"red"}}]}';
    const clean = '{"type":"doc","content":[{"type":"paragraph","attrs":{"color":"red"}}]}';
    const differentSafeValue =
      '{"type":"doc","content":[{"type":"paragraph","attrs":{"color":"blue"}}]}';

    // Unsafe keys are dropped, so the poisoned doc hashes identically to the clean one.
    expect(canonicalContentHash(withUnsafe)).toBe(canonicalContentHash(clean));
    // ...but attrs are not wholesale-ignored: changing a *safe* key still moves the hash.
    expect(canonicalContentHash(withUnsafe)).not.toBe(canonicalContentHash(differentSafeValue));
  });
```

- [ ] **Step 2: Run the test to verify it passes on current code (characterization)**

Run: `npm test -w packages/server -- content-hash`
Expected: PASS. This documents the existing strip behavior before the refactor touches it. (If it FAILS, stop — the assumption that the current code strips these keys is wrong and the design must be revisited.)

- [ ] **Step 3: Import the shared constant in `content-hash.ts`**

In `packages/server/src/snapshots/content-hash.ts`, change line 2 from:

```ts
import { MAX_TIPTAP_DEPTH } from "@smudge/shared";
```

to:

```ts
import { MAX_TIPTAP_DEPTH, CANONICAL_UNSAFE_KEYS } from "@smudge/shared";
```

- [ ] **Step 4: Delete the local `UNSAFE_KEYS` declaration**

In `packages/server/src/snapshots/content-hash.ts`, delete this comment block and constant (the second doc-comment block plus its `const`, currently lines 18–26):

```ts
/**
 * Keys that would mutate the scratch object's prototype chain when set
 * via bracket access. TipTapDocSchema uses .passthrough(), so content
 * read from the DB can legitimately carry any key — skip these so a
 * crafted `{"__proto__": {...}}` attrs value can't poison canonicalize.
 * Hashing proceeds with the key absent (dedup still works, the "poison"
 * attrs just doesn't contribute to the hash).
 */
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
```

(Leave the first doc-comment block — the one describing `canonicalize` and `CanonicalizeDepthError` — in place.)

- [ ] **Step 5: Update the one use of the constant**

In `packages/server/src/snapshots/content-hash.ts`, in `canonicalize()`, change:

```ts
    .filter(([k]) => !UNSAFE_KEYS.has(k))
```

to:

```ts
    .filter(([k]) => !CANONICAL_UNSAFE_KEYS.has(k))
```

- [ ] **Step 6: Run the server suite to verify behavior is preserved**

Run: `npm test -w packages/server -- content-hash snapshots.repository`
Expected: PASS (the new behavioral test and the existing canonicalization/snapshot tests all green with the shared constant).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/snapshots/content-hash.ts packages/server/src/__tests__/content-hash.test.ts
git commit -m "refactor(4b.10): content-hash imports shared CANONICAL_UNSAFE_KEYS

Replace the local UNSAFE_KEYS copy with the shared set; add a behavioral
test proving canonicalContentHash strips __proto__/prototype/constructor
(previously untested).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Migrate `tiptap-text.ts` to the shared constant

**Files:**
- Modify: `packages/shared/src/tiptap-text.ts`

- [ ] **Step 1: Import the shared constant**

In `packages/shared/src/tiptap-text.ts`, change line 11 (updated in Task 1) from:

```ts
import { MAX_TIPTAP_DEPTH as MAX_WALK_DEPTH } from "./tiptap-safety";
```

to:

```ts
import { MAX_TIPTAP_DEPTH as MAX_WALK_DEPTH, CANONICAL_UNSAFE_KEYS } from "./tiptap-safety";
```

- [ ] **Step 2: Delete the local `CANONICAL_UNSAFE_KEYS` declaration and refresh the function docstring**

In `packages/shared/src/tiptap-text.ts`, replace this block (the `canonicalJSON` docstring + the local constant, currently lines 488–496):

```ts
/**
 * Recursively serialize a value with sorted object keys so two objects
 * with the same content but different key insertion order compare equal.
 * Used for marks comparison below. Mirrors the UNSAFE_KEYS filter and
 * depth cap from content-hash.ts so prototype-pollution keys in
 * user-supplied mark attrs can't surprise this path, and a pathologically
 * nested attrs structure cannot stack-overflow the walker.
 */
const CANONICAL_UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
```

with (constant removed; comment updated to reflect that the strip-set is now shared, not mirrored):

```ts
/**
 * Recursively serialize a value with sorted object keys so two objects
 * with the same content but different key insertion order compare equal.
 * Used for marks comparison below. Uses the shared CANONICAL_UNSAFE_KEYS
 * filter and the MAX_TIPTAP_DEPTH cap so prototype-pollution keys in
 * user-supplied mark attrs can't surprise this path, and a pathologically
 * nested attrs structure cannot stack-overflow the walker.
 */
```

`canonicalJSON` itself is unchanged — it still references `CANONICAL_UNSAFE_KEYS` by the same name, now resolved from the import.

- [ ] **Step 3: Run the shared suite to verify behavior is preserved**

Run: `npm test -w packages/shared -- tiptap-text`
Expected: PASS (marks-comparison / canonicalization tests green with the shared constant).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/tiptap-text.ts
git commit -m "refactor(4b.10): tiptap-text imports shared CANONICAL_UNSAFE_KEYS

Remove the last local copy of the strip-set; canonicalJSON now uses the
shared symbol. Both canonicalization paths reference one declaration.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Confirm no local copies of the strip-set remain**

Run: `git grep -n '"__proto__"' -- packages/`
Expected: hits **only** in `packages/shared/src/tiptap-safety.ts` (the one shared declaration), `packages/shared/src/__tests__/tiptap-safety.test.ts`, and `packages/server/src/__tests__/content-hash.test.ts` (the behavioral test). **No** hit in `packages/shared/src/tiptap-text.ts` or `packages/server/src/snapshots/content-hash.ts` — those production files no longer declare the literal.

Then run: `git grep -n 'UNSAFE_KEYS' -- packages/`
Expected: every hit is `CANONICAL_UNSAFE_KEYS` (the shared declaration, the two imports, the two `.has()` uses, and the test) — no bare `UNSAFE_KEYS` declaration survives in `content-hash.ts`.

- [ ] **Step 2: Apply formatting (format-check is part of `make all`)**

Run: `make format`
Expected: prettier normalizes any line-length drift; review and stage any changes.

- [ ] **Step 3: Run the full CI gate**

Run: `make all`
Expected: PASS — `lint-check`, `format-check`, `typecheck`, `cover` (coverage floors held), and `e2e` all green.

- [ ] **Step 4: Commit any formatting-only changes (if `make format` changed files)**

```bash
git add -A
git commit -m "style(4b.10): prettier normalization

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Skip this step if `git status` is clean after Step 3.)

---

## Definition of Done (from the design)

- [ ] One declaration of the unsafe-key set, in `packages/shared/src/tiptap-safety.ts`.
- [ ] Both `tiptap-text.ts` and `content-hash.ts` import it; no local copies remain.
- [ ] `CANONICAL_UNSAFE_KEYS` exported directly from the `@smudge/shared` barrel (via `./tiptap-safety`), with a minimal export-wiring test.
- [ ] A behavioral test in `content-hash.test.ts` proves `canonicalContentHash` strips unsafe keys.
- [ ] The three relative importers point at `./tiptap-safety`.
- [ ] Existing tests in `tiptap-text.test.ts` and `content-hash.test.ts` (via `snapshots.repository.test.ts`) still green.
- [ ] `make all` green at PR close.
- [ ] No behavior change visible to the user.

## Out of scope (do not do)

- Extracting a unified `canonicalize()` function (blocked by the string-vs-object return-type mismatch).
- Changing the membership of the unsafe-key set.
- Any production change to the depth guard or depth-guarded walkers (Phase 4b.13).
- Moving the `MAX_TIPTAP_DEPTH`/`validateTipTapDepth` barrel export off `./schemas` (cosmetic; unrelated).
- Editing or committing `packages/shared/dist/`.
- Any CLAUDE.md change (the shared-primitive rule was reviewed and deliberately left below CLAUDE.md's altitude).
