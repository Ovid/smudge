# Phase 4b.13 — TipTap Depth-Guard Regression Test (Design)

**Date:** 2026-06-01
**Phase:** 4b.13 (roadmap `docs/roadmap.md`)
**Author:** Ovid / Claude (collaborative)
**Status:** Design approved; pending implementation plan
**Type:** Test-only. No production-code change.

## Goal

Add **one consolidated regression test** that pins the cross-cutting contract:
every consumer of TipTap JSON honors `MAX_TIPTAP_DEPTH = 64` and bails safely on
an over-depth structure. The constant is shared (`packages/shared/src/tiptap-safety.ts`),
but each walker implements its own depth-counted recursion, and there is no single
test that exercises all of them together. This phase adds that test.

The six walkers (verified against HEAD):

| # | Walker | Source file | Exported? |
|---|--------|-------------|-----------|
| 1 | `validateTipTapDepth` | `packages/shared/src/tiptap-safety.ts` | **yes** (public) |
| 2 | `extractText` | `packages/shared/src/wordcount.ts` | no (private) |
| 3 | `canonicalize` | `packages/server/src/snapshots/content-hash.ts` | no (private) |
| 4 | `walk` | `packages/server/src/images/images.references.ts` | no (nested fn) |
| 5 | `collectLeafBlocks` | `packages/shared/src/tiptap-text.ts` | no (private) |
| 6 | `canonicalJSON` | `packages/shared/src/tiptap-text.ts` | no (private) |

> **Spec correction:** roadmap §4b.13 says `validateTipTapDepth` lives in
> `tiptap-depth.ts`. The actual source is `tiptap-safety.ts`; `dist/tiptap-depth.d.ts`
> is stale build output. The test imports from `@smudge/shared` (which re-exports it),
> so this does not affect the test, but the design records the correct location.

## Key decisions

### Decision 1 — Reach private walkers through public entry points (no production change)

Five of the six walkers are private. Rather than add test-only exports (a
production-file change, even if precedented by `__resetWarnedFallbackDigestsForTests`),
the test drives each walker through its **public entry point**. This honors the DoD's
"No production-code change" and tests the contract that actually ships.

Trade-off accepted: the test asserts *publicly observable* behavior, which is
sometimes a transformed version of the walker's internal bail (e.g. `canonicalize`
throws internally but the wrapper catches it). A refactor that preserved public
behavior while breaking an internal cap could in principle slip through; this is an
accepted weakness of the public-entry approach and is partly mitigated by the deep-doc
overflow case (below).

### Decision 2 — Single test file in `packages/server`

`packages/shared` must not import `packages/server` (dependency direction + the client
also imports shared). Four public entries live in shared, two in server. Only the
server package can see all six, so the consolidated test lives at:

```
packages/server/src/__tests__/tiptap-depth-walkers.test.ts
```

Trade-off accepted: the server suite tests four functions that live in shared (mild
layering oddity), and those four are not covered by `npm test -w packages/shared`
(`make test` runs everything). This is the cost of the phase's explicit goal — ONE
contract test with ONE walker-registration header.

### Decision 3 — Boundary cases + one pathologically-deep overflow case

At depth 65, nothing stack-overflows (65 frames is trivial). Depth 65 verifies the
cap **activates at the documented boundary** — the bail behavior is what flips if a
future edit removes the cap. To *also* guard against true stack overflow (the cap's
actual purpose), the test adds one pathologically-deep fixture (~20,000 levels):
without the cap, that overflows; with it, every walker bails at 65 and returns safely.

## Fixtures (defined in the test file)

1. **`deepDoc(depth, payload?)`** — a linear TipTap tree nested `depth` content-levels:
   `{type:"doc", content:[{type:"...", content:[ … ]}]}`. The optional `payload` is
   placed at the deepest level — a `text` node, an `image` node with
   `attrs.src = "/api/images/<uuid>"`, or a matchable paragraph — so the over-depth
   bail visibly drops it.
2. **`paragraphWithDeepMarkAttrs(depth)`** — a paragraph containing one text node
   `"aa"` whose mark `attrs` nest `depth` deep. `canonicalJSON`'s depth axis is
   mark-attribute nesting (it only ever receives a `Mark[]`), **not** the document
   tree, so a doc-only fixture can never reach it. Driven via
   `replaceInDoc(…, "a", "b")` → `cleanupTextNodes` → `marksEqual` → `canonicalJSON`.

Exact boundary depths will be re-verified per walker during the RED phase, because the
walkers count differently: the tree walkers increment once per content-nesting level,
while `canonicalize` increments on every object **and** array level (so it reaches its
cap with fewer visual levels). Each fixture's depth is chosen so the target walker's
own counter exceeds 64 at the intended node.

## Walker-by-walker assertions

| Walker | Public entry | Boundary assertion (depth 65) | Deep assertion (~20k) |
|--------|--------------|-------------------------------|-----------------------|
| `validateTipTapDepth` | `validateTipTapDepth(doc)` | `=== false` | `=== false`, no `RangeError` |
| `extractText` | `countWords(doc)` (text at leaf) | `=== 0` (deep text dropped) | returns a number, no throw |
| `walk` | `extractImageIds(doc)` (image at leaf) | `=== []` (deep image dropped) | returns array, no throw |
| `canonicalize` | `canonicalContentHash(JSON.stringify(doc))` | returns 64-char hex **and** emits the `reason:"depth"` fallback warn | returns hash, no throw |
| `collectLeafBlocks` | `searchInDoc(doc, "x")` (matchable leaf at depth 65) | `=== []` (deep leaf block dropped) | returns array, no throw |
| `canonicalJSON` | `replaceInDoc(paragraphWithDeepMarkAttrs, "a", "b")` | completes, `count === 2`, no `RangeError` (weakest observable — accepted) | completes, no throw |

## Handling the `canonicalContentHash` warning

The depth fallback path in `canonicalContentHash` calls `logger.warn` (pino) with
`reason: "depth"`. The test:

- spies on the server `logger` to assert the `depth`-reason warn fired (positive
  evidence the cap activated) and to keep suite output clean;
- calls `__resetWarnedFallbackDigestsForTests()` (already exported from
  `content-hash.ts`) in setup so the once-per-digest dedupe cannot suppress the
  assertion across tests.

## Test-file header (the registration discipline)

A header comment in the test states, in substance:

> Any new TipTap-JSON walker must (1) import `MAX_TIPTAP_DEPTH` from `@smudge/shared`
> and implement a `depth > MAX_TIPTAP_DEPTH` bail, and (2) be added to this regression
> via its public entry point. A **seventh** walker triggers the
> extract-a-generic-walker re-evaluation deferred in dedup report I5
> (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md`).

## Out of scope

- Extracting a generic walker (deferred until a seventh consumer appears).
- Changing any of the six walkers' implementations or bail behaviors.
- Lint/automation enforcing the header discipline (consider only if a seventh walker
  arrives without joining the test).

## Definition of Done

- A test at `packages/server/src/__tests__/tiptap-depth-walkers.test.ts` that fails if
  any of the six walkers leaks a `RangeError` on the pathologically-deep doc, or fails
  to bail at the depth-65 boundary.
- Boundary assertions per the table above; one deep (~20k) no-throw case per walker.
- Test-file header documents the "new walker → add here" rule.
- `make all` green at PR close.
- No production-code change (no new exports, no walker edits).

## Dependencies

None. Test-only. May land in any order relative to other 4b.x phases.

## CLAUDE.md impact

None. Test-only phase; introduces no new invariant, API surface, data-model change,
or top-level structure. The walker-registration discipline is documented in the test
header by design, not at the repository-root level.
