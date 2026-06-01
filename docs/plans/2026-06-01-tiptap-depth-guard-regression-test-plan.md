# TipTap Depth-Guard Regression Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one consolidated regression test (`packages/server/src/__tests__/tiptap-depth-walkers.test.ts`) that pins all six TipTap-JSON walkers to honor `MAX_TIPTAP_DEPTH = 64`, each asserted through its public entry point with a *discriminating* signal that flips if the walker's depth bail is removed.

**Architecture:** Test-only. No production code changes are committed. Each walker is exercised through its public entry (`validateTipTapDepth`, `countWords`, `extractImageIds`, `canonicalContentHash`, `searchInDoc`, `replaceInDoc`). `@smudge/shared` resolves to live `src/`, so a temporary deletion of a walker's `if (depth > MAX…)` line is visible to the test — every task uses that to prove the assertion is a real regression (red), then restores the line (green) before committing.

**Tech Stack:** TypeScript, Vitest, `@smudge/shared`, better-sqlite3-free pure functions, pino `logger` (spied with `vi.spyOn`).

---

## Design reference

Design doc: `docs/plans/2026-06-01-tiptap-depth-guard-regression-test-design.md`. Read it first. Key constraints baked into this plan:

- **Public entry points only** — no new exports, no walker edits committed.
- **Single file in `packages/server`** — the only package that can import all six entries.
- **Discriminating assertions** — each flips if the cap is removed (verified per task).
- **`canonicalJSON` needs two marks that differ only below the cap** (a uniform mark would merge regardless — non-discriminating).
- **`collectLeafBlocks` fixture must nest via a container (non-leaf) node type** (`blockquote`), because it short-circuits on `LEAF_BLOCKS = {paragraph, heading, codeBlock}`.
- **No pathologically-deep fixture** — nest modestly past the cap (depth 100), trivially safe for `JSON.parse`/`stringify` (cf. existing `content-hash` CP2 which uses depth 200).

## Walker → public-entry → cap line (for the temporary-break verification)

| Walker | Public entry | Source file & cap line to delete-then-restore |
|--------|--------------|-----------------------------------------------|
| `validateTipTapDepth` | `validateTipTapDepth` | `packages/shared/src/tiptap-safety.ts` — `if (depth > MAX_TIPTAP_DEPTH) return false;` |
| `extractText` | `countWords` | `packages/shared/src/wordcount.ts` — `if (depth > MAX_TIPTAP_DEPTH) return "";` |
| `walk` | `extractImageIds` | `packages/server/src/images/images.references.ts` — `if (depth > MAX_TIPTAP_DEPTH) return;` |
| `collectLeafBlocks` | `searchInDoc` | `packages/shared/src/tiptap-text.ts` — `if (depth > MAX_WALK_DEPTH) return [];` (in `collectLeafBlocks`) |
| `canonicalize` | `canonicalContentHash` | `packages/server/src/snapshots/content-hash.ts` — `if (depth > MAX_TIPTAP_DEPTH) throw new CanonicalizeDepthError();` |
| `canonicalJSON` | `replaceInDoc` | `packages/shared/src/tiptap-text.ts` — `if (depth > MAX_WALK_DEPTH) return "null";` (in `canonicalJSON`) |

## Running tests

- **Fast iteration (single file):** `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts` from the repo root.
- **Authoritative pass at PR close:** `make all` (lint + format + typecheck + coverage + e2e). The walkers under test are pure functions (no DB), but `make` also runs `ensure-native`, so it is the safe final check after any host↔guest crossing.

---

### Task 1: Scaffold the test file, fixtures, and the `validateTipTapDepth` case

**Files:**
- Create: `packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
- Reference (do NOT commit edits): `packages/shared/src/tiptap-safety.ts`

- [ ] **Step 1: Write the file with the header comment, fixtures, and the first failing test**

Create `packages/server/src/__tests__/tiptap-depth-walkers.test.ts`:

```ts
/**
 * Cross-cutting depth-guard contract for TipTap-JSON walkers.
 *
 * Six walkers each implement their own depth-counted recursion capped at the
 * shared MAX_TIPTAP_DEPTH (64). This test pins that contract: each walker is
 * driven through its PUBLIC entry point with an assertion that flips if the
 * walker's `if (depth > MAX_TIPTAP_DEPTH)` bail is removed.
 *
 * ┌─ NEW WALKER? ────────────────────────────────────────────────────────────┐
 * │ Any new function that recurses TipTap JSON content MUST:                  │
 * │  1. import MAX_TIPTAP_DEPTH from "@smudge/shared" and bail when exceeded; │
 * │  2. be added to THIS test via its public entry point, with a             │
 * │     discriminating assertion (one that fails if the bail is removed).     │
 * │ A SEVENTH walker also triggers the "extract a generic walker" re-         │
 * │ evaluation deferred in dedup report I5                                     │
 * │ (paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18- │
 * │ 093074c.md).                                                              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The walkers count depth differently (tree walkers: 1 per content level;
 * canonicalize: object AND array levels; canonicalJSON: mark-attr nesting), so
 * a single over-cap depth (100) is chosen to exceed every walker's cap.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MAX_TIPTAP_DEPTH,
  validateTipTapDepth,
  countWords,
  searchInDoc,
  replaceInDoc,
} from "@smudge/shared";
import {
  canonicalContentHash,
  __resetWarnedFallbackDigestsForTests,
} from "../snapshots/content-hash";
import { extractImageIds } from "../images/images.references";
import { logger } from "../logger";

// Comfortably past MAX_TIPTAP_DEPTH (64); trivially safe for JSON.parse /
// JSON.stringify (content-hash CP2 uses 200 without issue).
const OVER_CAP_DEPTH = 100;
const SAMPLE_UUID = "11111111-1111-4111-8111-111111111111";

/**
 * Wrap `leaf` in `depth` nested `blockquote` levels under a `doc` root.
 * blockquote is NOT in collectLeafBlocks' LEAF_BLOCKS set, so every walker
 * recurses through the chain and hits its depth cap before reaching `leaf`.
 */
function deepDoc(depth: number, leaf: Record<string, unknown>): Record<string, unknown> {
  let node: Record<string, unknown> = leaf;
  for (let i = 0; i < depth; i++) {
    node = { type: "blockquote", content: [node] };
  }
  return { type: "doc", content: [node] };
}

describe("TipTap depth-guard contract (MAX_TIPTAP_DEPTH walkers)", () => {
  it("MAX_TIPTAP_DEPTH is the expected shared constant", () => {
    expect(MAX_TIPTAP_DEPTH).toBe(64);
  });

  it("validateTipTapDepth returns false for an over-cap document", () => {
    // Cap present → false. If the `depth > MAX` bail were removed it would
    // return true (no over-depth rejection).
    expect(validateTipTapDepth(deepDoc(OVER_CAP_DEPTH, { type: "text", text: "x" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes against current (correct) code**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS (2 tests). The cap exists, so `validateTipTapDepth` returns `false`.

- [ ] **Step 3: Prove the assertion is discriminating — temporarily remove the cap**

In `packages/shared/src/tiptap-safety.ts`, delete the line inside `validateTipTapDepth`:

```ts
  if (depth > MAX_TIPTAP_DEPTH) return false;
```

- [ ] **Step 4: Run the test to verify it now FAILS**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: FAIL — `validateTipTapDepth` now returns `true`, so `expect(...).toBe(false)` fails. This proves the assertion guards the cap.

- [ ] **Step 5: Restore the cap line and re-run**

Run: `git checkout packages/shared/src/tiptap-safety.ts`
Then: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS again. Confirm `git diff --stat` shows ONLY the new test file (no production change).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/__tests__/tiptap-depth-walkers.test.ts
git commit -m "test(4b.13): depth-guard contract scaffold + validateTipTapDepth case"
```

---

### Task 2: `extractText` via `countWords`

**Files:**
- Modify: `packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
- Reference (do NOT commit edits): `packages/shared/src/wordcount.ts`

- [ ] **Step 1: Add the failing test inside the `describe` block**

```ts
  it("countWords drops text below the depth cap (extractText bails)", () => {
    // Only text in the doc sits below the cap. Cap present → extractText
    // returns "" for the deep subtree → 0 words. If the bail were removed,
    // the deep "hello world" would be counted (>= 2).
    const doc = deepDoc(OVER_CAP_DEPTH, { type: "text", text: "hello world" });
    expect(countWords(doc)).toBe(0);
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS.

- [ ] **Step 3: Temporarily remove the cap**

In `packages/shared/src/wordcount.ts`, delete the line inside `extractText`:

```ts
  if (depth > MAX_TIPTAP_DEPTH) return "";
```

- [ ] **Step 4: Run to verify it FAILS**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: FAIL — `countWords` now returns `2` (reads "hello world"), so `toBe(0)` fails.

- [ ] **Step 5: Restore and re-run**

Run: `git checkout packages/shared/src/wordcount.ts`
Then: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS. Confirm `git diff --stat` shows only the test file.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/__tests__/tiptap-depth-walkers.test.ts
git commit -m "test(4b.13): extractText depth-guard case via countWords"
```

---

### Task 3: `walk` via `extractImageIds`

**Files:**
- Modify: `packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
- Reference (do NOT commit edits): `packages/server/src/images/images.references.ts`

- [ ] **Step 1: Add the failing test**

```ts
  it("extractImageIds drops an image below the depth cap (walk bails)", () => {
    // The only image reference sits below the cap. Cap present → walk skips
    // the deep subtree → []. If the bail were removed, the deep image's UUID
    // would be returned.
    const doc = deepDoc(OVER_CAP_DEPTH, {
      type: "image",
      attrs: { src: `/api/images/${SAMPLE_UUID}` },
    });
    expect(extractImageIds(doc)).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS.

- [ ] **Step 3: Temporarily remove the cap**

In `packages/server/src/images/images.references.ts`, delete the line inside `walk`:

```ts
    if (depth > MAX_TIPTAP_DEPTH) return;
```

- [ ] **Step 4: Run to verify it FAILS**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: FAIL — `extractImageIds` now returns `["11111111-1111-4111-8111-111111111111"]`, so `toEqual([])` fails.

- [ ] **Step 5: Restore and re-run**

Run: `git checkout packages/server/src/images/images.references.ts`
Then: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS. Confirm `git diff --stat` shows only the test file.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/__tests__/tiptap-depth-walkers.test.ts
git commit -m "test(4b.13): walk depth-guard case via extractImageIds"
```

---

### Task 4: `collectLeafBlocks` via `searchInDoc`

**Files:**
- Modify: `packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
- Reference (do NOT commit edits): `packages/shared/src/tiptap-text.ts`

- [ ] **Step 1: Add the failing test**

```ts
  it("searchInDoc finds nothing below the depth cap (collectLeafBlocks bails)", () => {
    // The matchable paragraph sits below the cap, reachable only by recursing
    // through the blockquote chain. Cap present → collectLeafBlocks bails
    // before reaching it → no leaf blocks → no matches. If the bail were
    // removed, the deep paragraph would be collected and "x" matched.
    const doc = deepDoc(OVER_CAP_DEPTH, {
      type: "paragraph",
      content: [{ type: "text", text: "x" }],
    });
    expect(searchInDoc(doc, "x")).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS.

- [ ] **Step 3: Temporarily remove the cap**

In `packages/shared/src/tiptap-text.ts`, delete the line inside `collectLeafBlocks`:

```ts
  if (depth > MAX_WALK_DEPTH) return [];
```

- [ ] **Step 4: Run to verify it FAILS**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: FAIL — `searchInDoc` now returns one match (length 1), so `toEqual([])` fails.

- [ ] **Step 5: Restore and re-run**

Run: `git checkout packages/shared/src/tiptap-text.ts`
Then: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS. Confirm `git diff --stat` shows only the test file.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/__tests__/tiptap-depth-walkers.test.ts
git commit -m "test(4b.13): collectLeafBlocks depth-guard case via searchInDoc"
```

---

### Task 5: `canonicalize` via `canonicalContentHash`

**Files:**
- Modify: `packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
- Reference (do NOT commit edits): `packages/server/src/snapshots/content-hash.ts`

- [ ] **Step 1: Add `beforeEach` reset and the failing test**

Add this `beforeEach` immediately inside the `describe` block (before the `it`s):

```ts
  beforeEach(() => {
    // canonicalContentHash warns once per unique content digest; reset the
    // per-process dedupe so this test's depth-warn is not suppressed by a
    // prior run.
    __resetWarnedFallbackDigestsForTests();
  });
```

Then add the test:

```ts
  it("canonicalContentHash falls back with a depth warning for over-cap JSON (canonicalize bails)", () => {
    // Cap present → canonicalize throws CanonicalizeDepthError internally,
    // caught by canonicalContentHash → raw-bytes hash + a reason:"depth" warn.
    // If the bail were removed, canonicalize would succeed (100 levels is well
    // within engine limits) → a canonical hash and NO warn.
    const json = JSON.stringify(deepDoc(OVER_CAP_DEPTH, { type: "text", text: "x" }));
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const hash = canonicalContentHash(json);
      expect(hash).toHaveLength(64);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "depth" }),
        expect.any(String),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS. (The `mockImplementation` keeps suite output clean — no real warn is emitted.)

- [ ] **Step 3: Temporarily remove the cap**

In `packages/server/src/snapshots/content-hash.ts`, delete the line inside `canonicalize`:

```ts
  if (depth > MAX_TIPTAP_DEPTH) throw new CanonicalizeDepthError();
```

- [ ] **Step 4: Run to verify it FAILS**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: FAIL — canonicalize succeeds, so no `reason:"depth"` warn fires and the `toHaveBeenCalledWith(... reason:"depth" ...)` assertion fails.

- [ ] **Step 5: Restore and re-run**

Run: `git checkout packages/server/src/snapshots/content-hash.ts`
Then: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS. Confirm `git diff --stat` shows only the test file.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/__tests__/tiptap-depth-walkers.test.ts
git commit -m "test(4b.13): canonicalize depth-guard case via canonicalContentHash"
```

---

### Task 6: `canonicalJSON` via `replaceInDoc` (two-mark divergence)

**Files:**
- Modify: `packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
- Reference (do NOT commit edits): `packages/shared/src/tiptap-text.ts`

- [ ] **Step 1: Add the mark-builder helper and the failing test**

Add this helper near the top of the file (below `deepDoc`):

```ts
/**
 * A mark whose attrs nest `depth` levels with `leafValue` at the bottom.
 * Two such marks share every level except the leaf — which sits BELOW the
 * cap, so canonicalJSON (used by marks comparison) truncates it to "null"
 * for both when the cap is present, making them compare equal.
 */
function markWithNestedAttrs(depth: number, leafValue: string): Record<string, unknown> {
  let attrs: Record<string, unknown> = { v: leafValue };
  for (let i = 0; i < depth; i++) attrs = { nested: attrs };
  return { type: "highlight", attrs };
}
```

Then add the test:

```ts
  it("replaceInDoc merges adjacent runs whose marks differ only below the cap (canonicalJSON bails)", () => {
    // Two adjacent text nodes carry marks identical above the cap and
    // divergent ("A" vs "B") only below it. Cap present → canonicalJSON
    // truncates both marks to the same string → marksEqual → the replacement
    // runs MERGE into a single text node. If canonicalJSON's bail were
    // removed, the marks would serialize fully, differ, and NOT merge.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [markWithNestedAttrs(OVER_CAP_DEPTH, "A")] },
            { type: "text", text: "a", marks: [markWithNestedAttrs(OVER_CAP_DEPTH, "B")] },
          ],
        },
      ],
    };
    const { doc: result, count } = replaceInDoc(doc, "a", "b");
    expect(count).toBe(2);
    const paragraph = (result.content as Array<Record<string, unknown>>)[0];
    const inline = paragraph.content as unknown[];
    expect(inline).toHaveLength(1); // merged: marks compared equal under the cap
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS. (If this fails on the merge expectation, re-verify against `tiptap-text.ts` that `cleanupTextNodes` runs on the rebuilt run and that `OVER_CAP_DEPTH` places the divergent leaf beyond canonicalJSON's depth counter — adjust `OVER_CAP_DEPTH` upward if the mark-attr counting needs it, per design Issue 4.)

- [ ] **Step 3: Temporarily remove the cap**

In `packages/shared/src/tiptap-text.ts`, delete the line inside `canonicalJSON`:

```ts
  if (depth > MAX_WALK_DEPTH) return "null";
```

- [ ] **Step 4: Run to verify it FAILS**

Run: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: FAIL — the marks now serialize fully and differ, so the runs do not merge; `inline` has length 2, failing `toHaveLength(1)`.

- [ ] **Step 5: Restore and re-run**

Run: `git checkout packages/shared/src/tiptap-text.ts`
Then: `npx vitest run packages/server/src/__tests__/tiptap-depth-walkers.test.ts`
Expected: PASS. Confirm `git diff --stat` shows only the test file.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/__tests__/tiptap-depth-walkers.test.ts
git commit -m "test(4b.13): canonicalJSON depth-guard case via replaceInDoc"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm no production code changed**

Run: `git diff main --stat -- packages/shared packages/server/src/images packages/server/src/snapshots`
Expected: NO production source files listed — only the new test file under `packages/server/src/__tests__/`. (If anything else appears, a temporary cap-deletion was not restored — `git checkout <file>` it.)

- [ ] **Step 2: Run the full authoritative suite**

Run: `make all`
Expected: green — lint, format, typecheck, coverage, and e2e all pass. The new test adds six walker assertions plus the constant check.

- [ ] **Step 3: Confirm the test-file header is present and accurate**

Open `packages/server/src/__tests__/tiptap-depth-walkers.test.ts` and verify the "NEW WALKER?" header block is present and names all six walkers' contract (import the constant, bail, add a discriminating case here). Fix wording if any walker was renamed during implementation.

- [ ] **Step 4: (If `make all` produced no new commit) ensure all work is committed**

Run: `git status`
Expected: clean working tree; six task commits present (`git log --oneline -6`).

---

## Self-Review

**1. Spec coverage** — every design requirement maps to a task:
- Public-entry-only, single server file → file location & imports in Task 1. ✓
- All six walkers asserted → Tasks 1 (validateTipTapDepth), 2 (extractText), 3 (walk), 4 (collectLeafBlocks), 5 (canonicalize), 6 (canonicalJSON). ✓
- Discriminating assertions with negative controls → the temporary-cap-removal step (Step 3–4) in every walker task. ✓
- `canonicalJSON` two-mark-divergence fixture → Task 6. ✓
- `collectLeafBlocks` container nesting → `deepDoc` uses `blockquote` (Task 1 helper), exploited in Task 4. ✓
- `canonicalize` depth-warn via logger spy + dedupe reset → Task 5. ✓
- No pathologically-deep fixture → `OVER_CAP_DEPTH = 100`; none added. ✓
- Test-file header documenting the "new walker → add here" rule → Task 1 Step 1; verified Task 7 Step 3. ✓
- No production-code change committed → Task 7 Step 1. ✓
- `make all` green → Task 7 Step 2. ✓

**2. Placeholder scan** — no TBD/TODO; every code step shows complete code; every run step shows the command and expected result.

**3. Type/name consistency** — `deepDoc`, `markWithNestedAttrs`, `OVER_CAP_DEPTH`, `SAMPLE_UUID` are defined once (Tasks 1 & 6) and reused consistently. Public-entry names (`validateTipTapDepth`, `countWords`, `extractImageIds`, `searchInDoc`, `replaceInDoc`, `canonicalContentHash`, `__resetWarnedFallbackDigestsForTests`) match the source files verified against HEAD.
